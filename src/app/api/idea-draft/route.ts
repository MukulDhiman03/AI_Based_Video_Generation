import { saveDraftSchema } from "@/lib/ideas";
import { getIdeaDraft, saveIdeaDraft } from "@/lib/server/ideas";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return ideaResponse(await getIdeaDraft(await ideaUser(request)));
  } catch (error) {
    return ideaFailure(error);
  }
}
export async function PUT(request: Request) {
  try {
    const userId = await ideaUser(request, true);
    const result = await saveIdeaDraft(
      userId,
      await ideaBody(request, saveDraftSchema),
    );
    return ideaResponse(result.record, result.conflict ? 409 : 200);
  } catch (error) {
    return ideaFailure(error);
  }
}
