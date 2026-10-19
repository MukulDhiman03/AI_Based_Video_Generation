import { getCurrentSession } from "@/lib/server/session";
import { getDashboardData } from "@/lib/server/dashboard";

export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getCurrentSession();
    if (!session)
      return Response.json(
        { error: "Sign in to view your dashboard." },
        { status: 401, headers },
      );
    return Response.json(await getDashboardData(session.user.id), { headers });
  } catch {
    return Response.json(
      { error: "Your dashboard is temporarily unavailable. Please try again." },
      { status: 503, headers },
    );
  }
}
