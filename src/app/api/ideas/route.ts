import { z } from "zod";
import { requestSchema } from "@/lib/ideas";
import { getIdeaRequest, runIdeaRequest } from "@/lib/server/ideas";
import {
  ideaBody,
  ideaFailure,
  ideaResponse,
  ideaUser,
  IdeaError,
} from "@/lib/server/idea-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const userId = await ideaUser(request);
    const id = new URL(request.url).searchParams.get("requestId");
    if (id !== null && !z.uuid().safeParse(id).success)
      throw new IdeaError("Invalid request ID.");
    return ideaResponse({
      request: await getIdeaRequest(userId, id ?? undefined),
    });
  } catch (error) {
    return ideaFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const userId = await ideaUser(request, true);
    const result = await runIdeaRequest(
      userId,
      await ideaBody(request, requestSchema),
    );
    return ideaResponse(
      { request: result },
      result.status === "running" ? 202 : 200,
    );
  } catch (error) {
    return ideaFailure(error);
  }
}
