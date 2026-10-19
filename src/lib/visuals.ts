import { z } from "zod";
import type { ContentForm, ContentPlan } from "./content-creation";

export const visualRequestSchema = z.object({
  revision: z.number().int().positive(),
  planRequestId: z.uuid(),
  action: z.enum(["start", "retry"]).default("start"),
});
export type VisualScene = {
  index: number;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  error: string | null;
  assetId: string | null;
};
export type VisualBatch = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  completed: number;
  total: number;
  scenes: VisualScene[];
  error: string | null;
  canRetry: boolean;
  retryAt: string | null;
  updatedAt: string;
};
export type VisualState = {
  revision: number;
  planRequestId: string | null;
  batch: VisualBatch | null;
  configuration: {
    storage: "r2" | null;
    ready: boolean;
    error: string | null;
    worker: "node" | "dispatch" | "disabled";
  };
};
export type VisualSnapshot = {
  form: ContentForm;
  plan: ContentPlan;
  revision: number;
  planRequestId: string;
  planHash: string;
};
export const MAX_SCENE_ATTEMPTS = 3;
export const VISUAL_LEASE_MS = 180_000;
export function visualSize(format: "reel" | "image") {
  return { width: 1080, height: format === "reel" ? 1920 : 1350 };
}
export function isCurrentVisualPlan(
  snapshot: VisualSnapshot,
  current: {
    revision: number;
    planning?: { requestId: string; status: string } | null;
    plan: ContentPlan | null;
  },
) {
  return (
    current.revision === snapshot.revision &&
    current.planning?.status === "completed" &&
    current.planning.requestId === snapshot.planRequestId &&
    current.plan !== null &&
    JSON.stringify(current.plan) === JSON.stringify(snapshot.plan)
  );
}
export function canApplyVisualState(
  started: { revision: number; planRequestId: string } | null,
  current: { revision: number; planRequestId: string } | null,
) {
  return (
    !!started &&
    !!current &&
    started.revision === current.revision &&
    started.planRequestId === current.planRequestId
  );
}
