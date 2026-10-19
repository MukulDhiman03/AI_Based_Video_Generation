import { createContentSchema } from "@/lib/content-creation";
import { createContentItem } from "@/lib/server/content-creation";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await ideaUser(request, true);
    return ideaResponse({
      item: await createContentItem(
        userId,
        await ideaBody(request, createContentSchema),
      ),
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
