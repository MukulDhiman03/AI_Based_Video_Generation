import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { z } from "zod";
import {
  visualRequestSchema,
  isCurrentVisualPlan,
  MAX_SCENE_ATTEMPTS,
  VISUAL_LEASE_MS,
  visualSize,
  type VisualState,
  type VisualSnapshot,
} from "../visuals";
import type { VisualWorkerDependencies, VisualWork } from "../visual-worker";
import { normalizeVisual, composeVisual } from "../visual-composition";
import { getDatabase, getMongoClient } from "./mongodb";
import { getContentItem, type ContentDocument } from "./content-creation";
import { IdeaError } from "./errors";
import { visualConfiguration } from "./visual-config";
import { generateVisual, imageModel } from "./gemini-visuals";
import {
  writeVisualObject,
  readVisualObject,
  deleteVisualObject,
  type VisualStorageRef,
  type VisualObjectStore,
} from "./visual-storage";

type Scene = {
  index: number;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  error: string | null;
  rawAssetId: string | null;
  assetId: string | null;
};
export type VisualJob = {
  _id: string;
  kind: "visuals";
  queue: string;
  userId: string;
  contentItemId: ObjectId;
  snapshot: VisualSnapshot;
  title: string;
  stage: "illustrations";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  scenes: Scene[];
  error: string | null;
  lease: string | null;
  leaseUntil: Date | null;
  retryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type VisualAsset = {
  _id: ObjectId;
  userId: string;
  contentItemId: ObjectId;
  jobId: string;
  planHash: string;
  sceneIndex: number;
  variant: "artwork" | "composition";
  width: number;
  height: number;
  bytes: number;
  mime: "image/png";
  storage: VisualStorageRef;
  model: string;
  createdAt: Date;
};
function queue() {
  return process.env.VISUAL_QUEUE || "visuals-v1";
}
export function makeVisualSnapshot(item: ContentDocument): VisualSnapshot {
  if (
    !item.plan ||
    item.planning?.status !== "completed" ||
    item.planning.sourceRevision !== item.revision
  )
    throw new IdeaError(
      "Generate and save a current plan before creating visuals.",
      409,
    );
  const planHash = createHash("sha256")
    .update(
      JSON.stringify({
        revision: item.revision,
        planRequestId: item.planning.requestId,
        form: item.form,
        plan: item.plan,
      }),
    )
    .digest("hex");
  return {
    form: item.form,
    plan: item.plan,
    revision: item.revision,
    planRequestId: item.planning.requestId,
    planHash,
  };
}
function jobId(userId: string, contentId: string, hash: string) {
  return `visual:${userId}:${contentId}:${hash}`;
}
function dto(job: VisualJob): NonNullable<VisualState["batch"]> {
  const expired =
    job.status === "running" &&
    !!job.leaseUntil &&
    job.leaseUntil.getTime() <= Date.now();
  return {
    id: job._id,
    status: expired ? "failed" : job.status,
    completed: job.scenes.filter((scene) => scene.status === "completed")
      .length,
    total: job.scenes.length,
    scenes: job.scenes.map((scene) => ({
      index: scene.index,
      title: scene.title,
      status: expired && scene.status === "running" ? "failed" : scene.status,
      attempts: scene.attempts,
      error:
        expired && scene.status === "running"
          ? "Generation was interrupted. Retry to resume."
          : scene.error,
      assetId: scene.assetId,
    })),
    error: expired
      ? "Generation was interrupted. Completed scenes are saved; retry to resume."
      : job.error,
    canRetry:
      (expired || job.status === "failed") &&
      job.scenes
        .filter((scene) => scene.status !== "completed")
        .every((scene) => scene.attempts < MAX_SCENE_ATTEMPTS),
    retryAt: job.retryAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}
export async function getVisualState(
  userId: string,
  contentId: string,
): Promise<VisualState> {
  const item = await getContentItem(userId, contentId);
  const configuration = visualConfiguration();
  if (!item.plan || item.planning?.status !== "completed")
    return {
      revision: item.revision,
      planRequestId: item.planning?.requestId ?? null,
      batch: null,
      configuration,
    };
  const snapshot = makeVisualSnapshot(item);
  const job = await (
    await getDatabase()
  )
    .collection<VisualJob>("generation_jobs")
    .findOne({
      _id: jobId(userId, contentId, snapshot.planHash),
      userId,
      kind: "visuals",
    });
  return {
    revision: item.revision,
    planRequestId: snapshot.planRequestId,
    batch: job ? dto(job) : null,
    configuration,
  };
}
export async function enqueueVisuals(
  userId: string,
  contentId: string,
  body: z.infer<typeof visualRequestSchema>,
) {
  const item = await getContentItem(userId, contentId);
  const snapshot = makeVisualSnapshot(item);
  if (
    item.revision !== body.revision ||
    snapshot.planRequestId !== body.planRequestId
  )
    throw new IdeaError(
      "The saved plan changed. Reload it before generating visuals.",
      409,
    );
  const jobs = (await getDatabase()).collection<VisualJob>("generation_jobs");
  const _id = jobId(userId, contentId, snapshot.planHash);
  let existing = await jobs.findOne({ _id, userId });
  if (existing && ["queued", "completed"].includes(existing.status))
    return getVisualState(userId, contentId);
  if (
    existing?.status === "running" &&
    existing.leaseUntil &&
    existing.leaseUntil.getTime() > Date.now()
  )
    return getVisualState(userId, contentId);
  const config = visualConfiguration();
  if (!config.ready) throw new IdeaError(config.error!, 503);
  if (existing) {
    const state = dto(existing);
    if (body.action !== "retry")
      return {
        revision: item.revision,
        planRequestId: snapshot.planRequestId,
        batch: state,
        configuration: config,
      };
    if (!state.canRetry)
      throw new IdeaError(
        "Unfinished scenes reached their retry limit. Review the brief and generate a new plan.",
        409,
      );
    if (existing.retryAt && existing.retryAt.getTime() > Date.now())
      throw new IdeaError(
        "Please wait for the visual-generation cooldown before retrying.",
        429,
      );
    const scenes = existing.scenes.map((scene) =>
      scene.status === "completed"
        ? scene
        : { ...scene, status: "pending" as const, error: null },
    );
    await jobs.updateOne(
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
          scenes,
          error: null,
          lease: null,
          leaseUntil: null,
          retryAt: null,
          updatedAt: new Date(),
        },
      },
    );
    return getVisualState(userId, contentId);
  }
  const job: VisualJob = {
    _id,
    kind: "visuals",
    queue: queue(),
    userId,
    contentItemId: item._id,
    snapshot,
    title: item.title,
    stage: "illustrations",
    status: "queued",
    scenes: snapshot.plan.scenes.map((scene, index) => ({
      index,
      title: scene.title,
      status: "pending",
      attempts: 0,
      error: null,
      rawAssetId: null,
      assetId: null,
    })),
    error: null,
    lease: null,
    leaseUntil: null,
    retryAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await jobs.insertOne(job);
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return getVisualState(userId, contentId);
}
export async function getVisualAsset(userId: string, assetId: string) {
  if (!/^[a-f\d]{24}$/i.test(assetId))
    throw new IdeaError("Visual not found.", 404);
  const asset = await (
    await getDatabase()
  )
    .collection<VisualAsset>("media_assets")
    .findOne({
      _id: new ObjectId(assetId),
      userId,
      variant: { $in: ["artwork", "composition"] },
    });
  if (!asset) throw new IdeaError("Visual not found.", 404);
  return asset;
}
export async function discardVisual(
  assetId: string,
  userId: string,
  storage?: VisualObjectStore,
) {
  const asset = await getVisualAsset(userId, assetId);
  await (storage?.remove ?? deleteVisualObject)(asset.storage);
  await (
    await getDatabase()
  )
    .collection<VisualAsset>("media_assets")
    .deleteOne({ _id: asset._id, userId });
}
class StaleVisualWrite extends Error {}
export function createVisualWorkerDependencies(
  options: { storage?: VisualObjectStore } = {},
): VisualWorkerDependencies {
  const storage = options.storage ?? {
    write: writeVisualObject,
    read: readVisualObject,
    remove: deleteVisualObject,
  };
  const jobs = async () =>
    (await getDatabase()).collection<VisualJob>("generation_jobs");
  return {
    async claim() {
      const collection = await jobs();
      // Interrupted calls never silently spend again: surface a manual retry.
      const expired = await collection.findOne({
        kind: "visuals",
        queue: queue(),
        status: "running",
        leaseUntil: { $lte: new Date() },
      });
      if (expired)
        await collection.updateOne(
          {
            _id: expired._id,
            status: "running",
            lease: expired.lease,
            leaseUntil: { $lte: new Date() },
          },
          {
            $set: {
              status: "failed",
              error:
                "The visual worker was interrupted. Retry unfinished scenes.",
              scenes: expired.scenes.map((scene) =>
                scene.status === "running"
                  ? {
                      ...scene,
                      status: "failed" as const,
                      error: "Interrupted during generation.",
                    }
                  : scene,
              ),
              retryAt: null,
              lease: null,
              leaseUntil: null,
              updatedAt: new Date(),
            },
          },
        );
      const job = await collection.findOne(
        { kind: "visuals", queue: queue(), status: "queued" },
        { sort: { updatedAt: 1 } },
      );
      if (!job) return null;
      const scene = job.scenes.find((scene) => scene.status === "pending");
      if (!scene || scene.attempts >= MAX_SCENE_ATTEMPTS) {
        await collection.updateOne(
          { _id: job._id, status: "queued" },
          {
            $set: {
              status: "failed",
              error: "No retryable scene remains.",
              updatedAt: new Date(),
            },
          },
        );
        return null;
      }
      const lease = randomUUID();
      const claimed = await collection.findOneAndUpdate(
        { _id: job._id, status: "queued", updatedAt: job.updatedAt },
        {
          $set: {
            status: "running",
            lease,
            leaseUntil: new Date(Date.now() + VISUAL_LEASE_MS),
            [`scenes.${scene.index}.status`]: "running",
            updatedAt: new Date(),
          },
          $inc: { [`scenes.${scene.index}.attempts`]: 1 },
        },
        { returnDocument: "after" },
      );
      return claimed
        ? {
            jobId: job._id,
            lease,
            index: scene.index,
            snapshot: job.snapshot,
            rawAssetId: scene.rawAssetId,
            referenceAssetId: scene.index > 0 ? job.scenes[0].rawAssetId : null,
            userId: job.userId,
          }
        : null;
    },
    async current(work) {
      const job = await (
        await jobs()
      ).findOne({
        _id: work.jobId,
        userId: work.userId,
        status: "running",
        lease: work.lease,
        leaseUntil: { $gt: new Date() },
      });
      if (!job) return false;
      try {
        return isCurrentVisualPlan(
          work.snapshot,
          await getContentItem(work.userId, job.contentItemId.toHexString()),
        );
      } catch (error) {
        if (error instanceof IdeaError && error.status === 404) return false;
        throw error;
      }
    },
    async admit(work) {
      if (process.env.VISUAL_GENERATION_ENABLED !== "true")
        throw new IdeaError(
          "Image generation is paused. Enable Gemini image access before resuming.",
          503,
        );
      const key = `visual_budget:${work.userId}:${Math.floor(Date.now() / 3_600_000)}`;
      try {
        await (
          await getDatabase()
        )
          .collection("app_settings")
          .updateOne(
            { key, used: { $lt: 24 } },
            { $inc: { used: 1 }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw new IdeaError(
            "Your hourly illustration limit has been reached. Completed scenes are saved; retry next hour.",
            429,
          );
        throw error;
      }
    },
    generate: (work, reference) =>
      generateVisual(work.snapshot, work.index, reference),
    async load(assetId, userId) {
      return storage.read((await getVisualAsset(userId, assetId)).storage);
    },
    normalize: (bytes, work) => {
      const size = visualSize(work.snapshot.form.config.format);
      return normalizeVisual(bytes, size.width, size.height);
    },
    compose: (bytes, work) => {
      const size = visualSize(work.snapshot.form.config.format);
      return composeVisual(
        bytes,
        work.snapshot.plan.scenes[work.index].onScreenText,
        size.width,
        size.height,
      );
    },
    async save(bytes, work, variant) {
      const _id = new ObjectId();
      const db = await getDatabase();
      const job = await (
        await jobs()
      ).findOne({ _id: work.jobId, userId: work.userId });
      if (!job) throw new StaleVisualWrite();
      const ref = await storage.write(bytes, {
        userId: work.userId,
        assetId: _id.toHexString(),
      });
      try {
        await db.collection<VisualAsset>("media_assets").insertOne({
          _id,
          userId: work.userId,
          contentItemId: job.contentItemId,
          jobId: work.jobId,
          planHash: work.snapshot.planHash,
          sceneIndex: work.index,
          variant,
          ...visualSize(work.snapshot.form.config.format),
          bytes: bytes.length,
          mime: "image/png",
          storage: ref,
          model: imageModel(),
          createdAt: new Date(),
        });
      } catch (error) {
        await storage.remove(ref).catch(() => undefined);
        throw error;
      }
      return _id.toHexString();
    },
    async checkpoint(work, assetId, variant) {
      const db = await getDatabase();
      const client = await getMongoClient();
      try {
        return await client.withSession((session) =>
          session.withTransaction(async () => {
            const job = await db
              .collection<VisualJob>("generation_jobs")
              .findOne(
                {
                  _id: work.jobId,
                  userId: work.userId,
                  status: "running",
                  lease: work.lease,
                  leaseUntil: { $gt: new Date() },
                },
                { session },
              );
            if (!job) return false;
            // This conditional write makes plan edits serialize against commits;
            // checking the content and then writing only the job is not enough.
            const fence = await db
              .collection<ContentDocument>("content_items")
              .updateOne(
                {
                  _id: job.contentItemId,
                  userId: work.userId,
                  revision: work.snapshot.revision,
                  "planning.requestId": work.snapshot.planRequestId,
                  "planning.status": "completed",
                  plan: work.snapshot.plan,
                },
                { $inc: { visualFence: 1 } },
                { session },
              );
            if (!fence.matchedCount) return false;
            const scenes = job.scenes.map((scene) =>
              scene.index === work.index
                ? {
                    ...scene,
                    ...(variant === "artwork"
                      ? { rawAssetId: assetId }
                      : { status: "completed" as const, assetId, error: null }),
                  }
                : scene,
            );
            const complete = scenes.every(
              (scene) => scene.status === "completed",
            );
            const result = await db
              .collection<VisualJob>("generation_jobs")
              .updateOne(
                {
                  _id: work.jobId,
                  userId: work.userId,
                  lease: work.lease,
                  status: "running",
                },
                {
                  $set: {
                    scenes,
                    status:
                      variant === "artwork"
                        ? "running"
                        : complete
                          ? "completed"
                          : "queued",
                    ...(variant === "composition"
                      ? {
                          lease: null,
                          leaseUntil: null,
                          error: null,
                          retryAt: null,
                        }
                      : { leaseUntil: new Date(Date.now() + VISUAL_LEASE_MS) }),
                    updatedAt: new Date(),
                  },
                },
                { session },
              );
            if (!result.matchedCount) throw new StaleVisualWrite();
            return true;
          }),
        );
      } catch (error) {
        if (error instanceof StaleVisualWrite) return false;
        throw error;
      }
    },
    discard: (assetId, userId) => discardVisual(assetId, userId, storage),
    async cancel(work) {
      await (
        await jobs()
      ).updateOne(
        {
          _id: work.jobId,
          userId: work.userId,
          lease: work.lease,
          status: "running",
        },
        {
          $set: {
            status: "cancelled",
            error:
              "The saved plan changed. Start visuals for the current plan.",
            lease: null,
            leaseUntil: null,
            updatedAt: new Date(),
          },
        },
      );
    },
    async fail(work, error) {
      const message =
        error instanceof IdeaError
          ? error.message
          : "The visual could not be prepared or stored. Completed artwork is retained; retry unfinished scenes.";
      const job = await (
        await jobs()
      ).findOne({
        _id: work.jobId,
        userId: work.userId,
        lease: work.lease,
        status: "running",
      });
      if (!job) return;
      await (
        await jobs()
      ).updateOne(
        {
          _id: work.jobId,
          userId: work.userId,
          lease: work.lease,
          status: "running",
        },
        {
          $set: {
            status: "failed",
            scenes: job.scenes.map((scene) =>
              scene.index === work.index
                ? { ...scene, status: "failed" as const, error: message }
                : scene,
            ),
            error: message,
            retryAt: new Date(
              Date.now() +
                (error instanceof IdeaError && [429, 503].includes(error.status)
                  ? 60_000
                  : 5_000),
            ),
            lease: null,
            leaseUntil: null,
            updatedAt: new Date(),
          },
        },
      );
    },
  };
}
