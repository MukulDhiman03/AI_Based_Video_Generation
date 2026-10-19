import { updateContentSchema } from "@/lib/content-creation";
import {
  contentItemDTO,
  updateContentItem,
} from "@/lib/server/content-creation";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const userId = await ideaUser(request);
    return ideaResponse({
      item: await contentItemDTO(userId, (await context.params).id),
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    const userId = await ideaUser(request, true);
    const result = await updateContentItem(
      userId,
      (await context.params).id,
      await ideaBody(request, updateContentSchema),
    );
    return ideaResponse({ item: result.item }, result.conflict ? 409 : 200);
  } catch (error) {
    return ideaFailure(error);
  }
}
