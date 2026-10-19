import { z } from "zod";

// Shared by the Node render command and the Remotion bundle. Generated media
// remains a runtime input, never a source-module dependency.
export const renderPlanSchema = z.object({
  title: z.string().min(1),
  voice: z.enum(["viraj", "monika"]),
  voiceId: z.string().optional(),
  fps: z.number().int().positive().max(120),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().positive(),
  words: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
      }),
    )
    .min(1),
  scenes: z
    .array(
      z.object({
        title: z.string(),
        label: z.string(),
        kind: z.string(),
        from: z.number().int().nonnegative(),
        to: z.number().int().positive(),
      }),
    )
    .min(1),
});

export function parseRenderPlan(input) {
  const result = renderPlanSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "A valid render plan is required. Run npm run generate before rendering.",
    );
  return result.data;
}
