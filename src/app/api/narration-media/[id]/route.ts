import { audioByteRange } from "@/lib/audio-range";
import { getNarrationAsset } from "@/lib/server/narration-jobs";
import { readVisualObject } from "@/lib/server/visual-storage";
import { ideaFailure, ideaUser } from "@/lib/server/idea-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const asset = await getNarrationAsset(
      await ideaUser(request),
      (await context.params).id,
    );
    const bytes = await readVisualObject(asset.storage),
      range = audioByteRange(request.headers.get("range"), bytes.length);
    const headers: Record<string, string> = {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="vidsutra-narration.mp3"`,
    };
    if (range === "invalid")
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    headers["Content-Length"] = String(body.length);
    if (range)
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${bytes.length}`;
    return new Response(new Uint8Array(body), {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
