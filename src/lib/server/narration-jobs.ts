import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId, type Filter } from "mongodb";
import type { z } from "zod";
import {
  narrationRequestSchema,
  narrationText,
  alignNarration,
  type NarrationState,
  type NarrationTiming,
} from "../narration";
import { isCurrentVisualPlan, type VisualSnapshot } from "../visuals";
import type {
  NarrationWork,
  NarrationWorkerDependencies,
  SavedSpeech,
} from "../narration-worker";
import { getDatabase, getMongoClient } from "./mongodb";
import { getContentItem } from "./content-creation";
import { makeVisualSnapshot } from "./visual-jobs";
import { IdeaError } from "./errors";
import { narrationConfiguration } from "./narration-config";
import {
  checkNarrationAccess,
  generateNarration,
  measureNarrationAudio,
} from "./elevenlabs-narration";
import {
  writeVisualObject,
  readVisualObject,
  deleteVisualObject,
  type VisualObjectStore,
  type VisualStorageRef,
} from "./visual-storage";
const LEASE = 240_000,
  MAX_ATTEMPTS = 3;
type Job = {
  _id: string;
  kind: "narration";
  queue: string;
  userId: string;
  contentItemId: ObjectId;
  snapshot: VisualSnapshot;
  title: string;
  stage: "speech" | "alignment" | "completed";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  voice: "viraj" | "monika";
  attempts: number;
  sourceAssetId: string | null;
  timing: NarrationTiming | null;
  error: string | null;
  lease: string | null;
  leaseUntil: Date | null;
  retryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type NarrationAsset = {
  _id: ObjectId;
  userId: string;
  contentItemId: ObjectId;
  jobId: string;
  variant: "narration";
  mime: "audio/mpeg";
  bytes: number;
  storage: VisualStorageRef;
  source: SavedSpeech;
  createdAt: Date;
};
const queue = () => process.env.VISUAL_QUEUE || "visuals-v1";
const jobs = async () =>
  (await getDatabase()).collection<Job>("generation_jobs");
const key = (userId: string, contentId: string, hash: string) =>
  `narration:${userId}:${contentId}:${hash}`;
async function context(userId: string, contentId: string) {
  const item = await getContentItem(userId, contentId);
  if (item.form.config.format !== "reel")
    throw new IdeaError("Narration is available for Reels only.", 409);
  if (
    !item.plan ||
    item.planning?.status !== "completed" ||
    item.planning.sourceRevision !== item.revision
  )
    throw new IdeaError(
      "Save a current Reel plan before generating narration.",
      409,
    );
  try {
    narrationText(item.plan);
  } catch (error) {
    throw new IdeaError((error as Error).message, 409);
  }
  return {
    item,
    snapshot: makeVisualSnapshot(item),
    voice: item.form.config.voice,
  };
}
function dto(job: Job): NonNullable<NarrationState["job"]> {
  const expired =
    job.status === "running" &&
    (!job.leaseUntil || job.leaseUntil.getTime() <= Date.now());
  return {
    id: job._id,
    status: expired ? "failed" : job.status,
    stage: job.stage,
    voice: job.voice,
    attempts: job.attempts,
    error: expired
      ? "Narration was interrupted. Recover status, then retry manually. The previous request may have used credits."
      : job.error,
    canRetry:
      (expired || job.status === "failed") && job.attempts < MAX_ATTEMPTS,
    retryAt: job.retryAt?.toISOString() ?? null,
    audioAssetId: job.status === "completed" ? job.sourceAssetId : null,
    timing: job.status === "completed" ? job.timing : null,
    updatedAt: job.updatedAt.toISOString(),
  };
}
export async function getNarrationState(
  userId: string,
  contentId: string,
): Promise<NarrationState> {
  const { item, snapshot, voice } = await context(userId, contentId);
  const job = await (
    await jobs()
  ).findOne({
    _id: key(userId, contentId, snapshot.planHash),
    userId,
    kind: "narration",
  });
  return {
    revision: item.revision,
    planRequestId: snapshot.planRequestId,
    job: job ? dto(job) : null,
    configuration: narrationConfiguration(voice),
  };
}
export async function enqueueNarration(
  userId: string,
  contentId: string,
  body: z.infer<typeof narrationRequestSchema>,
) {
  const { item, snapshot, voice } = await context(userId, contentId);
  if (
    item.revision !== body.revision ||
    snapshot.planRequestId !== body.planRequestId
  )
    throw new IdeaError(
      "The saved plan changed. Reload before generating narration.",
      409,
    );
  const collection = await jobs(),
    _id = key(userId, contentId, snapshot.planHash),
    existing = await collection.findOne({ _id, userId });
  if (
    existing &&
    (["queued", "completed"].includes(existing.status) ||
      (existing.status === "running" &&
        existing.leaseUntil &&
        existing.leaseUntil.getTime() > Date.now()))
  )
    return getNarrationState(userId, contentId);
  const config = narrationConfiguration(voice);
  if (!config.ready) throw new IdeaError(config.error!, 503);
  if (existing) {
    if (body.action !== "retry") return getNarrationState(userId, contentId);
    if (!dto(existing).canRetry)
      throw new IdeaError(
        "Narration reached its retry limit. Review the script and generate a new plan.",
        409,
      );
    if (existing.retryAt && existing.retryAt.getTime() > Date.now())
      throw new IdeaError("Wait for the narration retry cooldown.", 429);
    await collection.updateOne(
      {
        _id,
        userId,
        status: existing.status,
        lease: existing.lease,
        updatedAt: existing.updatedAt,
      },
      {
        $set: {
          status: "queued",
          error: null,
          lease: null,
          leaseUntil: null,
          retryAt: null,
          updatedAt: new Date(),
        },
      },
    );
  } else {
    const now = new Date();
    try {
      await collection.insertOne({
        _id,
        kind: "narration",
        queue: queue(),
        userId,
        contentItemId: item._id,
        snapshot,
        title: item.title,
        voice,
        stage: "speech",
        status: "queued",
        attempts: 0,
        sourceAssetId: null,
        timing: null,
        error: null,
        lease: null,
        leaseUntil: null,
        retryAt: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  return getNarrationState(userId, contentId);
}
export async function getNarrationAsset(userId: string, id: string) {
  if (!/^[a-f\d]{24}$/i.test(id))
    throw new IdeaError("Narration audio not found.", 404);
  const asset = await (
    await getDatabase()
  )
    .collection<NarrationAsset>("media_assets")
    .findOne({ _id: new ObjectId(id), userId, variant: "narration" });
  if (!asset) throw new IdeaError("Narration audio not found.", 404);
  return asset;
}
const defaultStorage: VisualObjectStore = {
  write: writeVisualObject,
  read: readVisualObject,
  remove: deleteVisualObject,
};
export async function discardNarration(
  id: string,
  userId: string,
  storage = defaultStorage,
) {
  const asset = await getNarrationAsset(userId, id);
  await storage.remove(asset.storage);
  await (
    await getDatabase()
  )
    .collection("media_assets")
    .deleteOne({ _id: asset._id, userId });
}
class StaleNarrationWrite extends Error {}
export function createNarrationWorkerDependencies(
  options: {
    storage?: VisualObjectStore;
    checkAccess?: typeof checkNarrationAccess;
  } = {},
): NarrationWorkerDependencies {
  const storage = options.storage ?? defaultStorage;
  const owned = (w: NarrationWork): Filter<Job> => ({
    _id: w.jobId,
    userId: w.userId,
    status: "running",
    lease: w.lease,
  });
  async function fenced(w: NarrationWork, updates: Partial<Job>) {
    const db = await getDatabase(),
      client = await getMongoClient();
    try {
      return await client.withSession((session) =>
        session.withTransaction(async () => {
          const job = await db
            .collection<Job>("generation_jobs")
            .findOne(
              { ...owned(w), leaseUntil: { $gt: new Date() } },
              { session },
            );
          if (!job) return false;
          const fence = await db
            .collection("content_items")
            .updateOne(
              {
                _id: job.contentItemId,
                userId: w.userId,
                revision: w.snapshot.revision,
                "planning.requestId": w.snapshot.planRequestId,
                "planning.status": "completed",
                plan: w.snapshot.plan,
              },
              { $inc: { narrationFence: 1 } },
              { session },
            );
          if (!fence.matchedCount) return false;
          const result = await db
            .collection<Job>("generation_jobs")
            .updateOne(
              owned(w),
              { $set: { ...updates, updatedAt: new Date() } },
              { session },
            );
          if (!result.matchedCount) throw new StaleNarrationWrite();
          return true;
        }),
      );
    } catch (error) {
      if (error instanceof StaleNarrationWrite) return false;
      throw error;
    }
  }
  return {
    async claim() {
      const collection = await jobs(),
        now = new Date();
      await collection.updateMany(
        {
          kind: "narration",
          queue: queue(),
          status: "running",
          leaseUntil: { $lte: now },
        },
        {
          $set: {
            status: "failed",
            error:
              "Narration was interrupted. Retry manually; the previous request may have consumed credits.",
            lease: null,
            leaseUntil: null,
            retryAt: null,
            updatedAt: now,
          },
        },
      );
      const lease = randomUUID();
      const job = await collection.findOneAndUpdate(
        {
          kind: "narration",
          queue: queue(),
          status: "queued",
          attempts: { $lt: MAX_ATTEMPTS },
        },
        {
          $set: {
            status: "running",
            lease,
            leaseUntil: new Date(Date.now() + LEASE),
            updatedAt: now,
          },
          $inc: { attempts: 1 },
        },
        { sort: { updatedAt: 1 }, returnDocument: "after" },
      );
      if (!job) return null;
      return {
        jobId: job._id,
        lease,
        userId: job.userId,
        contentId: job.contentItemId.toHexString(),
        snapshot: job.snapshot,
        voice: job.voice,
        sourceAssetId: job.sourceAssetId,
      };
    },
    async current(w) {
      if (
        !(await (
          await jobs()
        ).findOne({ ...owned(w), leaseUntil: { $gt: new Date() } }))
      )
        return false;
      try {
        return isCurrentVisualPlan(
          w.snapshot,
          await getContentItem(w.userId, w.contentId),
        );
      } catch (error) {
        if (error instanceof IdeaError && error.status === 404) return false;
        throw error;
      }
    },
    async admit(w) {
      const config = narrationConfiguration(w.voice);
      if (!config.ready) throw new IdeaError(config.error!, 503);
      const key = `narration_budget:${w.userId}:${Math.floor(Date.now() / 3_600_000)}`;
      try {
        await (
          await getDatabase()
        )
          .collection("app_settings")
          .updateOne(
            { key, used: { $lt: 6 } },
            { $inc: { used: 1 }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw new IdeaError(
            "The hourly narration limit has been reached. Retry next hour.",
            429,
          );
        throw error;
      }
      await (options.checkAccess ?? checkNarrationAccess)(
        w.voice,
        narrationText(w.snapshot.plan).length,
      );
    },
    generate: (w) => generateNarration(w.voice, narrationText(w.snapshot.plan)),
    measure: measureNarrationAudio,
    async save(w, result, duration) {
      const _id = new ObjectId(),
        ref = await storage.write(result.audio, {
          userId: w.userId,
          assetId: _id.toHexString(),
          format: "mp3",
        });
      try {
        await (
          await getDatabase()
        )
          .collection<NarrationAsset>("media_assets")
          .insertOne({
            _id,
            userId: w.userId,
            contentItemId: new ObjectId(w.contentId),
            jobId: w.jobId,
            variant: "narration",
            mime: "audio/mpeg",
            bytes: result.audio.length,
            storage: ref,
            source: {
              alignment: result.alignment,
              normalizedAlignment: result.normalizedAlignment,
              duration,
            },
            createdAt: new Date(),
          });
      } catch (error) {
        await storage.remove(ref).catch(() => undefined);
        throw error;
      }
      return _id.toHexString();
    },
    async load(id, userId) {
      return (await getNarrationAsset(userId, id)).source;
    },
    checkpoint: (w, id) =>
      fenced(w, {
        sourceAssetId: id,
        stage: "alignment",
        leaseUntil: new Date(Date.now() + LEASE),
      }),
    align: (w, source) =>
      alignNarration(w.snapshot.plan, source, source.duration),
    complete: (w, timing) =>
      fenced(w, {
        status: "completed",
        stage: "completed",
        timing,
        error: null,
        lease: null,
        leaseUntil: null,
        retryAt: null,
      }),
    discard: (id, userId) => discardNarration(id, userId, storage),
    async cancel(w) {
      await (
        await jobs()
      ).updateOne(owned(w), {
        $set: {
          status: "cancelled",
          error: "The saved plan changed.",
          lease: null,
          leaseUntil: null,
          updatedAt: new Date(),
        },
      });
    },
    async fail(w, error) {
      const message =
        error instanceof IdeaError
          ? error.message
          : error instanceof Error &&
              /timing|timestamp|script|scene|duration|narration exceeds/i.test(
                error.message,
              )
            ? error.message
            : "Narration could not be prepared or stored. Saved audio is retained. Recover status before retrying; a new speech request may consume credits.";
      await (
        await jobs()
      ).updateOne(owned(w), {
        $set: {
          status: "failed",
          error: message,
          retryAt: new Date(
            Date.now() +
              (error instanceof IdeaError && [429, 503].includes(error.status)
                ? 60_000
                : 5000),
          ),
          lease: null,
          leaseUntil: null,
          updatedAt: new Date(),
        },
      });
    },
  };
}
