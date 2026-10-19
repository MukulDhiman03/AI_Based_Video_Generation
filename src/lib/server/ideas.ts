import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  emptyDraft,
  inputKey,
  type DraftRecord,
  type IdeaRequest,
  type IdeaInput,
  type Idea,
  requestSchema,
  saveDraftSchema,
} from "../ideas";
import { getDatabase } from "./mongodb";
import { IdeaError } from "./errors";
import { suggestIdeas } from "./gemini-ideas";

type RequestDocument = {
  _id: string;
  userId: string;
  requestId: string;
  input: IdeaInput;
  status: IdeaRequest["status"];
  ideas: Idea[];
  error: string | null;
  lease: string;
  leaseUntil: Date;
  attempts: number;
  createdAt: Date;
};
type DraftDocument = {
  _id: string;
  userId: string;
  revision: number;
  mutationId: string;
  draft: DraftRecord["draft"];
  updatedAt: Date;
};
function requestDTO(record: RequestDocument): IdeaRequest {
  const expired =
    record.status === "running" && record.leaseUntil.getTime() <= Date.now();
  return {
    requestId: record.requestId,
    input: record.input,
    status: expired ? "failed" : record.status,
    ideas: record.ideas,
    error: expired
      ? "This request was interrupted. Retry to recover it."
      : record.error,
    retryAt:
      record.status !== "completed" ? record.leaseUntil.toISOString() : null,
  };
}
export async function getIdeaRequest(userId: string, requestId?: string) {
  const db = await getDatabase();
  const result = await db
    .collection<RequestDocument>("idea_requests")
    .findOne(
      requestId ? { _id: `${userId}:${requestId}`, userId } : { userId },
      { sort: { createdAt: -1 } },
    );
  return result ? requestDTO(result) : null;
}
export async function runIdeaRequest(
  userId: string,
  body: z.infer<typeof requestSchema>,
) {
  const { requestId, ...input } = body;
  const db = await getDatabase();
  const requests = db.collection<RequestDocument>("idea_requests");
  const _id = `${userId}:${requestId}`;
  let record = await requests.findOne({ _id, userId });
  if (record && inputKey(record.input) !== inputKey(input))
    throw new IdeaError(
      "This request belongs to a different brief. Generate a new request.",
      409,
    );
  if (record?.status === "completed") return requestDTO(record);
  if (record && record.leaseUntil.getTime() > Date.now())
    return requestDTO(record);
  if (record && record.attempts >= 3)
    throw new IdeaError(
      "This request has reached its retry limit. Generate new ideas to continue.",
      409,
    );
  const lease = randomUUID();
  const leaseUntil = new Date(Date.now() + 65_000);
  if (!record) {
    if (
      (await requests.countDocuments({
        userId,
        createdAt: { $gte: new Date(Date.now() - 3_600_000) },
      })) >= 12
    )
      throw new IdeaError(
        "You have reached the hourly idea request limit. Please try later.",
        429,
      );
    record = {
      _id,
      userId,
      requestId,
      input,
      status: "running",
      ideas: [],
      error: null,
      lease,
      leaseUntil,
      attempts: 1,
      createdAt: new Date(),
    };
    try {
      await requests.insertOne(record);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await requests.findOne({ _id, userId });
      if (!existing || inputKey(existing.input) !== inputKey(input))
        throw new IdeaError("Request brief changed. Generate new ideas.", 409);
      return requestDTO(existing);
    }
  } else {
    const claimed = await requests.findOneAndUpdate(
      {
        _id,
        userId,
        lease: record.lease,
        leaseUntil: { $lte: new Date() },
        status: { $ne: "completed" },
      },
      {
        $set: { lease, leaseUntil, status: "running", error: null },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (!claimed) return (await getIdeaRequest(userId, requestId))!;
    record = claimed;
  }
  try {
    const ideas = await suggestIdeas(input);
    await requests.updateOne(
      { _id, userId, lease, status: "running" },
      { $set: { status: "completed", ideas, error: null } },
    );
  } catch (error) {
    await requests.updateOne(
      { _id, userId, lease, status: "running" },
      {
        $set: {
          status: "failed",
          error:
            error instanceof IdeaError
              ? error.message
              : "Could not generate ideas. Please retry.",
          leaseUntil: new Date(
            Date.now() +
              (error instanceof IdeaError && [429, 503].includes(error.status)
                ? 60_000
                : 5_000),
          ),
        },
      },
    );
  }
  return (await getIdeaRequest(userId, requestId))!;
}
function draftDTO(record: DraftDocument | null): DraftRecord {
  return record
    ? {
        revision: record.revision,
        mutationId: record.mutationId,
        draft: record.draft,
        updatedAt: record.updatedAt.toISOString(),
      }
    : { revision: 0, mutationId: null, draft: emptyDraft, updatedAt: null };
}
export async function getIdeaDraft(userId: string) {
  return draftDTO(
    await (
      await getDatabase()
    )
      .collection<DraftDocument>("idea_drafts")
      .findOne({ _id: userId, userId }),
  );
}
export async function saveIdeaDraft(
  userId: string,
  body: z.infer<typeof saveDraftSchema>,
) {
  const drafts = (await getDatabase()).collection<DraftDocument>("idea_drafts");
  const current = await drafts.findOne({ _id: userId, userId });
  if (
    current?.mutationId === body.mutationId &&
    JSON.stringify(current.draft) === JSON.stringify(body.draft)
  )
    return { record: draftDTO(current), conflict: false };
  if ((current?.revision ?? 0) !== body.revision)
    return { record: draftDTO(current), conflict: true };
  const update = {
    draft: body.draft,
    mutationId: body.mutationId,
    revision: body.revision + 1,
    updatedAt: new Date(),
  };
  if (body.revision === 0) {
    try {
      await drafts.insertOne({ _id: userId, userId, ...update });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      return { record: await getIdeaDraft(userId), conflict: true };
    }
  } else {
    const saved = await drafts.findOneAndUpdate(
      { _id: userId, userId, revision: body.revision },
      { $set: update },
      { returnDocument: "after" },
    );
    if (!saved) return { record: await getIdeaDraft(userId), conflict: true };
  }
  // Return this write's snapshot. A concurrent later write must not be
  // acknowledged as though it were the caller's own save.
  return {
    record: draftDTO({ _id: userId, userId, ...update }),
    conflict: false,
  };
}
