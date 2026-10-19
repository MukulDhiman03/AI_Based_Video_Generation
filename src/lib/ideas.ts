import { z } from "zod";

export const categories = [
  "All topics",
  "Computer science",
  "Physics & astronomy",
  "Biology & health",
  "Everyday science",
  "History & origins",
] as const;
export const ideaInputSchema = z.object({
  topic: z.string().trim().min(3).max(300),
  category: z.enum(categories),
  language: z.enum(["en", "hi"]),
  format: z.enum(["reel", "image"]),
});
export const ideaSchema = z.object({
  title: z.string().trim().min(3).max(160),
  hook: z.string().trim().min(3).max(300),
  summary: z.string().trim().min(10).max(800),
  category: z.string().trim().min(2).max(60),
});
export const ideasOutputSchema = z.object({
  ideas: z.array(ideaSchema).length(6),
});
export const requestSchema = ideaInputSchema.extend({ requestId: z.uuid() });
export const draftSchema = z
  .object({
    title: z.string().max(160),
    hook: z.string().max(300),
    summary: z.string().max(2000),
    format: z.enum(["reel", "image"]),
    language: z.enum(["en", "hi"]),
    review: z.enum(["pending", "approved", "dismissed"]),
    sourceRequestId: z.uuid().nullable(),
    sourceIndex: z.number().int().min(0).max(5).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.review === "approved" &&
      (!value.title.trim() || !value.summary.trim())
    )
      ctx.addIssue({
        code: "custom",
        message: "Add a title and explanation before approving.",
      });
  });
export const saveDraftSchema = z.object({
  revision: z.number().int().nonnegative(),
  mutationId: z.uuid(),
  draft: draftSchema,
});
export type IdeaInput = z.infer<typeof ideaInputSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type DraftRecord = {
  revision: number;
  mutationId: string | null;
  draft: Draft;
  updatedAt: string | null;
};
export type IdeaRequest = {
  requestId: string;
  input: IdeaInput;
  status: "running" | "completed" | "failed";
  ideas: Idea[];
  error: string | null;
  retryAt: string | null;
};
export const emptyDraft: Draft = {
  title: "",
  hook: "",
  summary: "",
  format: "reel",
  language: "en",
  review: "pending",
  sourceRequestId: null,
  sourceIndex: null,
};
export function inputKey(input: IdeaInput) {
  return JSON.stringify([
    input.topic.trim(),
    input.category,
    input.language,
    input.format,
  ]);
}
export function acceptsResult(
  current: IdeaInput,
  requestId: string | null,
  result: IdeaRequest,
) {
  return (
    result.requestId === requestId &&
    inputKey(current) === inputKey(result.input)
  );
}
export function editDraft(draft: Draft, patch: Partial<Draft>): Draft {
  return { ...draft, ...patch, review: "pending" };
}
