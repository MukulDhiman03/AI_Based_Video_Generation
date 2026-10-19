import { after } from "next/server";
import { visualRequestSchema } from "@/lib/visuals";
import { getVisualState, enqueueVisuals } from "@/lib/server/visual-jobs";
import { runVisualStep, startVisualWorker } from "@/lib/server/visual-runner";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return ideaResponse(
      await getVisualState(await ideaUser(request), (await context.params).id),
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const userId = await ideaUser(request, true);
    const body = await ideaBody(request, visualRequestSchema);
    const state = await enqueueVisuals(userId, (await context.params).id, body);
    if (state.batch?.status === "queued") {
      if (state.configuration.worker === "node") startVisualWorker();
      else if (state.configuration.worker === "dispatch")
        after(async () => {
          await runVisualStep();
        });
    }
    return ideaResponse(
      state,
      state.batch && ["queued", "running"].includes(state.batch.status)
        ? 202
        : 200,
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
