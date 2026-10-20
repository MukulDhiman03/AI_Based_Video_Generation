import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { z } from "zod";
import {
  contentFormSchema,
  defaultConfig,
  formKey,
  type ContentForm,
  type ContentItem,
  type ContentPlan,
  type PlanRequest,
  createContentSchema,
  updateContentSchema,
  planRequestSchema,
} from "../content-creation";
import { getDatabase } from "./mongodb";
import { getIdeaDraft } from "./ideas";
import { IdeaError } from "./errors";
import { cancelStaleVisualJobs } from "./visual-invalidation";
import { generateContentPlan } from "./gemini-plan";

type StoredPlanning = Omit<PlanRequest, "retryAt"> & {
  lease: string;
  leaseUntil: Date;
};
export type ContentDocument = {
  _id: ObjectId;
  userId: string;
  creationId: string;
  creationKey: string;
  revision: number;
  visualFence?: number;
  narrationFence?: number;
  mutationId: string | null;
  form: ContentForm;
  title: string;
  format: "reel" | "image";
  language: "en" | "hi";
  status: "draft";
  plan: ContentPlan | null;
  planning: StoredPlanning | null;
  createdAt: Date;
  updatedAt: Date;
};
function dto(item: ContentDocument): ContentItem {
  const job = item.planning;
  const expired =
    job?.status === "running" && job.leaseUntil.getTime() <= Date.now();
  return {
    id: item._id.toHexString(),
    creationId: item.creationId,
    revision: item.revision,
    mutationId: item.mutationId,
    form: item.form,
    plan:
      job?.status === "completed" && job.sourceRevision === item.revision
        ? item.plan
        : null,
    planning: job
      ? {
          requestId: job.requestId,
          sourceRevision: job.sourceRevision,
          status: expired ? "failed" : job.status,
          error: expired
            ? "Planning was interrupted. Retry to resume."
            : job.error,
          retryAt:
            job.status === "completed" ? null : job.leaseUntil.toISOString(),
          attempts: job.attempts,
        }
      : null,
    updatedAt: item.updatedAt.toISOString(),
  };
}
function objectId(id: string) {
  if (!/^[a-f\d]{24}$/i.test(id))
    throw new IdeaError("Content draft not found.", 404);
  return new ObjectId(id);
}
export async function getContentItem(userId: string, id: string) {
  const item = await (
    await getDatabase()
  )
    .collection<ContentDocument>("content_items")
    .findOne({ _id: objectId(id), userId, form: { $exists: true } });
  if (!item) throw new IdeaError("Content draft not found.", 404);
  return item;
}
export async function contentItemDTO(userId: string, id: string) {
  return dto(await getContentItem(userId, id));
}
export async function createContentItem(
  userId: string,
  body: z.infer<typeof createContentSchema>,
) {
  const items = (await getDatabase()).collection<ContentDocument>(
    "content_items",
  );
  const creationKey = JSON.stringify(body);
  const existing = await items.findOne({ userId, creationId: body.creationId });
  if (existing) {
    if (existing.creationKey !== creationKey)
      throw new IdeaError(
        "This creation request already belongs to another draft.",
        409,
      );
    return dto(existing);
  }
  let form: ContentForm;
  if (body.mode === "idea") {
    const idea = await getIdeaDraft(userId);
    if (idea.revision !== body.ideaRevision || idea.draft.review !== "approved")
      throw new IdeaError(
        "Save and approve the current idea before continuing.",
        409,
      );
    const { title, hook, summary, language, format } = idea.draft;
    form = {
      brief: { title, hook, summary },
      config:
        format === "reel"
          ? { ...defaultConfig, format, language, duration: 60, voice: "viraj" }
          : {
              format,
              language,
              visualStyle: "infographic",
              duration: null,
              voice: null,
            },
    };
  } else form = body.form;
  if (!contentFormSchema.safeParse(form).success)
    throw new IdeaError(
      "Add a title of at least 3 characters and an explanation of at least 10 characters before continuing.",
      400,
    );
  const item: ContentDocument = {
    _id: new ObjectId(),
    userId,
    creationId: body.creationId,
    creationKey,
    revision: 1,
    mutationId: null,
    form,
    title: form.brief.title,
    format: form.config.format,
    language: form.config.language,
    status: "draft",
    plan: null,
    planning: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await items.insertOne(item);
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await items.findOne({ userId, creationId: body.creationId });
    if (!winner || winner.creationKey !== creationKey)
      throw new IdeaError("Creation request conflict. Reload your draft.", 409);
    return dto(winner);
  }
  return dto(item);
}
export async function updateContentItem(
  userId: string,
  id: string,
  body: z.infer<typeof updateContentSchema>,
) {
  const current = await getContentItem(userId, id);
  if (
    current.mutationId === body.mutationId &&
    formKey(current.form) === formKey(body.form)
  )
    return { item: dto(current), conflict: false };
  if (current.revision !== body.revision)
    return { item: dto(current), conflict: true };
  const saved = await (
    await getDatabase()
  )
    .collection<ContentDocument>("content_items")
    .findOneAndUpdate(
      { _id: current._id, userId, revision: body.revision },
      {
        $set: {
          form: body.form,
          title: body.form.brief.title,
          format: body.form.config.format,
          language: body.form.config.language,
          mutationId: body.mutationId,
          plan: null,
          planning: null,
          updatedAt: new Date(),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
  if (saved)
    await cancelStaleVisualJobs(userId, saved._id, saved.revision, null);
  return saved
    ? { item: dto(saved), conflict: false }
    : { item: await contentItemDTO(userId, id), conflict: true };
}
export async function planContentItem(
  userId: string,
  id: string,
  body: z.infer<typeof planRequestSchema>,
) {
  const current = await getContentItem(userId, id);
  if (current.revision !== body.revision)
    return { item: dto(current), conflict: true };
  const previous = current.planning;
  if (previous?.requestId === body.requestId && previous.status === "completed")
    return { item: dto(current), conflict: false };
  if (
    previous &&
    previous.leaseUntil.getTime() > Date.now() &&
    (previous.status === "running" || previous.requestId === body.requestId)
  )
    return { item: dto(current), conflict: false };
  if (previous?.requestId === body.requestId && previous.attempts >= 3)
    throw new IdeaError(
      "This planning request reached its retry limit. Start a new plan.",
      409,
    );
  const lease = randomUUID();
  const planning: StoredPlanning = {
    requestId: body.requestId,
    sourceRevision: current.revision,
    status: "running",
    error: null,
    lease,
    leaseUntil: new Date(Date.now() + 65_000),
    attempts:
      previous?.requestId === body.requestId ? previous.attempts + 1 : 1,
  };
  const items = (await getDatabase()).collection<ContentDocument>(
    "content_items",
  );
  const claimed = await items.findOneAndUpdate(
    {
      _id: current._id,
      userId,
      revision: current.revision,
      ...(previous ? { "planning.lease": previous.lease } : { planning: null }),
    },
    { $set: { planning, plan: null } },
    { returnDocument: "after" },
  );
  if (!claimed)
    return { item: await contentItemDTO(userId, id), conflict: false };
  await cancelStaleVisualJobs(
    userId,
    current._id,
    current.revision,
    body.requestId,
  );
  const owner = {
    _id: current._id,
    userId,
    revision: current.revision,
    "planning.lease": lease,
  };
  try {
    // Atomic, database-backed ceiling for provider calls, shared by all
    // instances. Failed/retried attempts also consume an admission slot.
    const budgetKey = `planning_budget:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    try {
      await (
        await getDatabase()
      )
        .collection("app_settings")
        .updateOne(
          { key: budgetKey, used: { $lt: 12 } },
          { $inc: { used: 1 }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new IdeaError(
          "Your hourly planning limit has been reached. Your draft is saved; try again next hour.",
          429,
        );
      throw error;
    }
    const plan = await generateContentPlan(current.form);
    await items.updateOne(owner, {
      $set: {
        plan,
        "planning.status": "completed",
        "planning.error": null,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    await items.updateOne(owner, {
      $set: {
        "planning.status": "failed",
        "planning.error":
          error instanceof IdeaError
            ? error.message
            : "Planning failed. Retry later.",
        "planning.leaseUntil": new Date(
          Date.now() +
            (error instanceof IdeaError && [429, 503].includes(error.status)
              ? 60_000
              : 5_000),
        ),
      },
    });
  }
  return { item: await contentItemDTO(userId, id), conflict: false };
}
