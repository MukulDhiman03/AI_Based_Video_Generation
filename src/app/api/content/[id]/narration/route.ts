import { after } from "next/server";
import { narrationRequestSchema } from "@/lib/narration";
import {
  getNarrationState,
  enqueueNarration,
} from "@/lib/server/narration-jobs";
import {
  runNarrationStep,
  startVisualWorker,
} from "@/lib/server/visual-runner";
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
      await getNarrationState(
        await ideaUser(request),
        (await context.params).id,
      ),
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const userId = await ideaUser(request, true),
      body = await ideaBody(request, narrationRequestSchema);
    const state = await enqueueNarration(
      userId,
      (await context.params).id,
      body,
    );
    if (state.job?.status === "queued") {
      if (process.env.VISUAL_WORKER_MODE === "node") startVisualWorker();
      else if (process.env.VISUAL_WORKER_MODE === "dispatch")
        after(async () => {
          await runNarrationStep();
        });
    }
    return ideaResponse(
      state,
      state.job && ["queued", "running"].includes(state.job.status) ? 202 : 200,
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
