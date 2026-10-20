import { captionFile } from "@/lib/narration";
import { getNarrationState } from "@/lib/server/narration-jobs";
import { IdeaError, ideaFailure, ideaUser } from "@/lib/server/idea-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const state = await getNarrationState(
      await ideaUser(request),
      (await context.params).id,
    );
    if (state.job?.status !== "completed" || !state.job.timing)
      throw new IdeaError(
        "Complete narration alignment before downloading captions.",
        409,
      );
    const requested = new URL(request.url).searchParams.get("format") ?? "srt";
    if (requested !== "srt" && requested !== "vtt")
      throw new IdeaError("Choose SRT or VTT captions.", 400);
    return new Response(captionFile(state.job.timing, requested), {
      headers: {
        "Content-Type":
          requested === "vtt"
            ? "text/vtt; charset=utf-8"
            : "application/x-subrip; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="vidsutra-captions.${requested}"`,
      },
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
