import "server-only";
import { ObjectId, type Document } from "mongodb";
import type { DashboardContent, DashboardData } from "../dashboard";
import { getDatabase } from "./mongodb";

function text(value: unknown, fallback: string, length = 160) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, length)
    : fallback;
}

function date(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return value.toISOString();
}

function content(document: Document): DashboardContent {
  const allowed = ["draft", "queued", "processing", "completed", "failed"];
  return {
    id: String(document._id),
    editable: typeof document.creationId === "string",
    title: text(document.title, "Untitled explanation"),
    format: document.format === "image" ? "image" : "reel",
    language:
      document.language === "hi" || document.language === "Hindi"
        ? "Hindi"
        : "English",
    status: allowed.includes(document.status)
      ? document.status
      : document.status === "ready"
        ? "completed"
        : "draft",
    updatedAt: date(document.updatedAt ?? document.createdAt),
  };
}

// Accept only a validated session's ID. Every user-owned query includes it.
// Explicit projections/DTOs prevent account tokens and internal fields leaking.
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const db = await getDatabase();
  const owner = {
    userId: {
      $in: ObjectId.isValid(userId) ? [userId, new ObjectId(userId)] : [userId],
    },
  };
  const projection = {
    title: 1,
    creationId: 1,
    format: 1,
    language: 1,
    status: 1,
    updatedAt: 1,
    createdAt: 1,
  };
  const [recent, featured, totalContent, job, publications, social, allowance] =
    await Promise.all([
      db
        .collection("content_items")
        .find(owner, { projection })
        .sort({ updatedAt: -1, _id: -1 })
        .limit(6)
        .toArray(),
      db
        .collection("content_items")
        .findOne(
          { ...owner, status: { $in: ["completed", "ready"] } },
          { projection, sort: { updatedAt: -1, _id: -1 } },
        ),
      db.collection("content_items").countDocuments(owner),
      db.collection("generation_jobs").findOne(
        { ...owner, status: { $in: ["queued", "running", "processing"] } },
        {
          projection: { title: 1, status: 1, stage: 1 },
          sort: { createdAt: -1 },
        },
      ),
      db
        .collection("publications")
        .find(
          { ...owner, status: "scheduled" },
          { projection: { title: 1, scheduledFor: 1, status: 1 } },
        )
        .sort({ scheduledFor: 1 })
        .limit(3)
        .toArray(),
      db
        .collection("social_accounts")
        .findOne(
          { ...owner, provider: "instagram" },
          { projection: { username: 1, status: 1, expiresAt: 1 } },
        ),
      db
        .collection("app_settings")
        .findOne(
          { key: `generation_allowance:${userId}` },
          { projection: { limit: 1, used: 1, resetsAt: 1 } },
        ),
    ]);
  const stages: Record<string, string> = {
    planning: "Planning",
    illustrations: "Illustrations",
    narration: "Narration",
    speech: "Narration",
    alignment: "Caption alignment",
    animation: "Animation",
    rendering: "Rendering",
    checks: "Final checks",
  };
  const hasAllowance =
    allowance &&
    Number.isSafeInteger(allowance.limit) &&
    allowance.limit >= 0 &&
    Number.isSafeInteger(allowance.used) &&
    allowance.used >= 0;
  const expired =
    social?.status === "expired" ||
    (social?.status === "connected" &&
      social?.expiresAt instanceof Date &&
      social.expiresAt.getTime() <= Date.now());
  return {
    recentContent: recent.map(content),
    featured: featured ? content(featured) : null,
    totalContent,
    activeJob: job
      ? {
          id: String(job._id),
          title: text(job.title, "Your explanation"),
          status: job.status === "queued" ? "Queued" : "In progress",
          stage: stages[job.stage] ?? null,
        }
      : null,
    upcoming: publications.map((post) => ({
      id: String(post._id),
      title: text(post.title, "Scheduled post"),
      scheduledFor: date(post.scheduledFor),
      status: "Scheduled",
    })),
    connection: {
      status: expired
        ? "expired"
        : social?.status === "connected"
          ? "connected"
          : "disconnected",
      username: social?.username ? text(social.username, "", 80) : null,
    },
    allowance: hasAllowance
      ? {
          limit: allowance.limit,
          used: allowance.used,
          resetsAt: date(allowance.resetsAt),
        }
      : null,
  };
}
