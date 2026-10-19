import { timingSafeEqual } from "node:crypto";
import { runVisualStep } from "@/lib/server/visual-runner";
import { ideaResponse } from "@/lib/server/idea-http";
export const runtime = "nodejs";
export const maxDuration = 180;
async function run(request: Request) {
  const secret = process.env.VISUAL_WORKER_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const candidate = Buffer.from(supplied);
  if (
    !secret ||
    secret.length < 32 ||
    candidate.length !== expected.length ||
    !timingSafeEqual(candidate, expected)
  )
    return ideaResponse({ error: "Not authorized." }, 401);
  try {
    return ideaResponse({ processed: await runVisualStep() });
  } catch {
    return ideaResponse(
      { error: "Visual processor temporarily unavailable." },
      503,
    );
  }
}
export const GET = run;
export const POST = run;
