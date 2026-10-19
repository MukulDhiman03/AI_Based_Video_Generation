import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

// React cache is scoped to the request, never shared between accounts.
export const getCurrentSession = cache(async () => {
  const requestHeaders = await headers();
  return (await getAuth()).api.getSession({ headers: requestHeaders });
});

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  return session;
}
