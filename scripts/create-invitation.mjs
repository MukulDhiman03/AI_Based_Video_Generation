import { randomBytes, createHash } from "node:crypto";
import { MongoClient } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run invite -- invited-person@example.com");
  process.exit(1);
}
let client;
try {
  const { uri, databaseName } = getMongoConfig();
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  const db = client.db(databaseName);
  const owner = await db
    .collection("_app_metadata")
    .findOne({ _id: "vidsutra-ai" });
  if (owner?.application !== "vidsutra-ai")
    throw new Error("Run database setup first.");
  if (await db.collection("user").findOne({ email }))
    throw new Error("This email already has an account.");
  const token = randomBytes(32).toString("base64url");
  await db.collection("beta_invitations").insertOne({
    email,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const url = new URL("/sign-up", process.env.BETTER_AUTH_URL);
  url.searchParams.set("invite", token);
  console.log(
    "Private invitation created; expires in seven days. Share only with the invited recipient.",
  );
  console.log(url.toString());
  console.log("No email was sent.");
} catch {
  console.error(
    "Invitation could not be created. Check configuration, database access, or whether the email already has an account.",
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
