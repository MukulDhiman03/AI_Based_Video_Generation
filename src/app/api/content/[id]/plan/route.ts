import { planRequestSchema } from "@/lib/content-creation";
import { planContentItem } from "@/lib/server/content-creation";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await ideaUser(request, true);
    const result = await planContentItem(
      userId,
      (await context.params).id,
      await ideaBody(request, planRequestSchema),
    );
    return ideaResponse(
      { item: result.item },
      result.conflict
        ? 409
        : result.item.planning?.status === "running"
          ? 202
          : 200,
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
