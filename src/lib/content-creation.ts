import { z } from "zod";

const brief = z.object({
  title: z.string().trim().min(3).max(160),
  hook: z.string().trim().max(300),
  summary: z.string().trim().min(10).max(2000),
});
const common = {
  language: z.enum(["en", "hi"]),
  visualStyle: z.literal("infographic"),
};
export const contentConfigSchema = z.discriminatedUnion("format", [
  z.object({
    ...common,
    format: z.literal("reel"),
    duration: z.union([z.literal(30), z.literal(60), z.literal(90)]),
    voice: z.enum(["viraj", "monika"]),
  }),
  z.object({
    ...common,
    format: z.literal("image"),
    duration: z.null(),
    voice: z.null(),
  }),
]);
export const contentRecoverySchema = z.object({
  brief: z.object({
    title: z.string().max(160),
    hook: z.string().max(300),
    summary: z.string().max(2000),
  }),
  config: contentConfigSchema,
});
export const contentFormSchema = z.object({
  brief,
  config: contentConfigSchema,
});
export const createContentSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("idea"),
    creationId: z.uuid(),
    ideaRevision: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal("manual"),
    creationId: z.uuid(),
    form: contentFormSchema,
  }),
]);
export const updateContentSchema = z.object({
  revision: z.number().int().positive(),
  mutationId: z.uuid(),
  form: contentFormSchema,
});
export const planRequestSchema = z.object({
  revision: z.number().int().positive(),
  requestId: z.uuid(),
});
export const contentPlanSchema = z.object({
  title: z.string().trim().min(3).max(160),
  caption: z.string().trim().min(10).max(2200),
  scenes: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(100),
        narration: z.string().trim().max(1500),
        visual: z.string().trim().min(10).max(1000),
        onScreenText: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(8),
});
export type ContentForm = z.infer<typeof contentFormSchema>;
export type ContentConfig = z.infer<typeof contentConfigSchema>;
export type ContentPlan = z.infer<typeof contentPlanSchema>;
export type PlanRequest = {
  requestId: string;
  sourceRevision: number;
  status: "running" | "completed" | "failed";
  error: string | null;
  retryAt: string | null;
  attempts: number;
};
export type ContentItem = {
  id: string;
  creationId: string;
  revision: number;
  mutationId: string | null;
  form: ContentForm;
  plan: ContentPlan | null;
  planning: PlanRequest | null;
  updatedAt: string;
};
export const defaultConfig: ContentConfig = {
  format: "reel",
  language: "en",
  duration: 60,
  voice: "viraj",
  visualStyle: "infographic",
};
export const voiceLabels = {
  viraj: "Viraj · Energetic & confident",
  monika: "Monika · Deep & natural",
};
export function sceneCount(config: ContentConfig) {
  return config.format === "image"
    ? 1
    : config.duration === 30
      ? 4
      : config.duration === 60
        ? 6
        : 8;
}
export function formKey(form: ContentForm) {
  return JSON.stringify(contentFormSchema.parse(form));
}
export function validateContentPlan(input: unknown, config: ContentConfig) {
  const plan = contentPlanSchema.parse(input);
  if (plan.scenes.length !== sceneCount(config))
    throw new Error("Incorrect scene count.");
  if (
    config.format === "reel" &&
    plan.scenes.some((scene) => !scene.narration.trim())
  )
    throw new Error("Narration is missing.");
  if (
    config.format === "image" &&
    plan.scenes.some((scene) => scene.narration !== "")
  )
    throw new Error("Image posts must not contain narration.");
  return plan;
}
