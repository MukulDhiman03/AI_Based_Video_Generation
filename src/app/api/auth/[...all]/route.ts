import { getAuth } from "@/lib/server/auth";

export const runtime = "nodejs";

async function handler(request: Request) {
  try {
    return await (await getAuth()).handler(request);
  } catch {
    return Response.json(
      {
        code: "AUTH_UNAVAILABLE",
        message: "We couldn’t connect right now. Please try again shortly.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export { handler as GET, handler as POST };
