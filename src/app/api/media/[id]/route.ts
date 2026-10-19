import { getVisualAsset } from "@/lib/server/visual-jobs";
import { readVisualObject } from "@/lib/server/visual-storage";
import { ideaFailure, ideaUser } from "@/lib/server/idea-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await ideaUser(request);
    const asset = await getVisualAsset(userId, (await context.params).id);
    const bytes = await readVisualObject(asset.storage);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="vidsutra-${asset.variant}-${asset.sceneIndex + 1}.png"`,
      },
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
