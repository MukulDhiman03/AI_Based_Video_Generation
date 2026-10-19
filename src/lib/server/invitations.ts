import "server-only";
import { createHash } from "node:crypto";
import { getDatabase } from "./mongodb";

export function hashInvitation(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function findInvitation(token: string, email?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = await getDatabase();
  return db.collection("beta_invitations").findOne({
    tokenHash: hashInvitation(token),
    status: "pending",
    expiresAt: { $gt: new Date() },
    ...(email ? { email: email.trim().toLowerCase() } : {}),
  });
}
