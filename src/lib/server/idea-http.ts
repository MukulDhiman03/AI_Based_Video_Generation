import "server-only";
import { z } from "zod";
import { getCurrentSession } from "./session";

import { IdeaError } from "./errors";
export { IdeaError } from "./errors";
export function ideaResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function ideaUser(request: Request, write = false) {
  if (
    write &&
    request.headers.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL!).origin
  )
    throw new IdeaError("This request origin is not allowed.", 403);
  const session = await getCurrentSession();
  if (!session) throw new IdeaError("Sign in to continue.", 401);
  return session.user.id;
}
export async function ideaBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new IdeaError("Send JSON data.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new IdeaError("Request data is missing.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 16_384) {
      await reader.cancel();
      throw new IdeaError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new IdeaError("Check the required fields and their lengths.");
  }
}
export function ideaFailure(error: unknown) {
  return ideaResponse(
    {
      error:
        error instanceof IdeaError
          ? error.message
          : "Your studio is temporarily unavailable. Please retry.",
    },
    error instanceof IdeaError ? error.status : 503,
  );
}
