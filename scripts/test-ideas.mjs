import assert from "node:assert/strict";
import "./test-draft-save-queue.mjs";
import { randomUUID, randomBytes } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";
import {
  acceptsResult,
  editDraft,
  emptyDraft,
  draftSchema,
  ideasOutputSchema,
} from "../src/lib/ideas.ts";

const input = {
  topic: "How the internet works",
  category: "Computer science",
  language: "en",
  format: "reel",
};
const requestId = randomUUID();
const ideas = Array.from({ length: 6 }, (_, index) => ({
  title: `Internet question ${index + 1}`,
  hook: "What happens after you click?",
  summary: "Follow a request from a browser to a server and back again.",
  category: "Computer science",
}));
const result = {
  requestId,
  input,
  status: "completed",
  ideas,
  error: null,
  retryAt: null,
};
assert.ok(acceptsResult(input, requestId, result));
assert.ok(
  !acceptsResult(input, randomUUID(), result),
  "Older requests must be rejected.",
);
for (const patch of [
  { topic: "Another topic" },
  { category: "All topics" },
  { language: "hi" },
  { format: "image" },
]) {
  assert.ok(
    !acceptsResult({ ...input, ...patch }, requestId, result),
    "Every brief field invalidates stale results.",
  );
}
assert.equal(
  editDraft({ ...emptyDraft, review: "approved" }, { title: "Edited" }).review,
  "pending",
);
assert.ok(
  !draftSchema.safeParse({ ...emptyDraft, review: "approved" }).success,
);
assert.ok(ideasOutputSchema.safeParse({ ideas }).success);
assert.ok(!ideasOutputSchema.safeParse({ ideas: ideas.slice(1) }).success);
console.log(
  "PASS: stale-result gating, review invalidation, and provider output validation.",
);

if (!process.argv.includes("--integration")) process.exit(0);
const origin = process.env.BETTER_AUTH_URL;
assert.equal(
  new URL(origin).hostname,
  "127.0.0.1",
  "Integration tests target the local app only.",
);
const { uri, databaseName } = getMongoConfig();
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
const email = `ideas-qa-${randomUUID()}@example.invalid`;
const testIp = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
let db, userId, cookie;
async function call(
  path,
  method = "GET",
  body,
  authenticated = true,
  requestOrigin = origin,
) {
  return fetch(origin + path, {
    method,
    redirect: "manual",
    headers: {
      origin: requestOrigin,
      "x-forwarded-for": testIp,
      "Content-Type": "application/json",
      ...(authenticated && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  await client.connect();
  db = client.db(databaseName);
  const signup = await call(
    "/api/auth/sign-up/email",
    "POST",
    {
      name: "Ideas QA",
      email,
      password: `Qa-${randomBytes(20).toString("hex")}`,
    },
    false,
  );
  assert.equal(signup.status, 200);
  cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const account = await signup.json();
  userId = account.user.id;
  assert.equal((await call("/api/ideas", "GET", undefined, false)).status, 401);
  assert.equal(
    (await call("/api/idea-draft", "GET", undefined, false)).status,
    401,
  );
  assert.equal(
    (await call("/home/ideas", "GET", undefined, false)).status,
    307,
  );
  assert.equal(
    (
      await call(
        "/api/ideas",
        "POST",
        { requestId, ...input },
        true,
        "https://foreign.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/idea-draft", "PUT", {}, true, "https://foreign.invalid"))
      .status,
    403,
  );
  assert.equal(
    (await call("/api/ideas", "POST", { requestId: "bad" })).status,
    400,
  );
  assert.equal(
    (
      await call("/api/idea-draft", "PUT", {
        revision: -1,
        mutationId: randomUUID(),
        draft: emptyDraft,
      })
    ).status,
    400,
  );
  assert.equal((await call("/api/ideas?requestId=bad")).status, 400);
  const foreignId = randomUUID();
  await db.collection("idea_requests").insertOne({
    _id: `${userId}:foreign-fixture`,
    userId: `foreign-${userId}`,
    requestId: foreignId,
    input,
    status: "completed",
    ideas,
    createdAt: new Date(),
  });
  assert.equal(
    (await (await call(`/api/ideas?requestId=${foreignId}`)).json()).request,
    null,
  );
  assert.equal((await (await call("/api/ideas")).json()).request, null);
  const record = {
    _id: `${userId}:${requestId}`,
    userId,
    requestId,
    input,
    status: "completed",
    ideas,
    error: null,
    lease: randomUUID(),
    leaseUntil: new Date(),
    attempts: 1,
    createdAt: new Date(),
  };
  await db.collection("idea_requests").insertOne(record);
  const recovery = await call(`/api/ideas?requestId=${requestId}`);
  assert.equal(recovery.headers.get("cache-control"), "no-store");
  assert.deepEqual((await recovery.json()).request.ideas, ideas);
  const replays = await Promise.all([
    call("/api/ideas", "POST", { requestId, ...input }),
    call("/api/ideas", "POST", { requestId, ...input }),
  ]);
  for (const replay of replays) {
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).request.status, "completed");
  }
  assert.equal(
    (await db.collection("idea_requests").findOne({ _id: record._id }))
      .attempts,
    1,
    "Completed replay must not call Gemini again.",
  );
  assert.equal(
    (
      await call("/api/ideas", "POST", {
        requestId,
        ...input,
        topic: "Changed brief",
      })
    ).status,
    409,
  );
  await db.collection("idea_requests").updateOne(
    { _id: record._id },
    {
      $set: { status: "running", leaseUntil: new Date(Date.now() + 60_000) },
    },
  );
  assert.equal(
    (await call("/api/ideas", "POST", { requestId, ...input })).status,
    202,
    "An active lease must not start duplicate work.",
  );
  await db
    .collection("idea_requests")
    .updateOne(
      { _id: record._id },
      { $set: { leaseUntil: new Date(Date.now() - 1_000), attempts: 3 } },
    );
  assert.equal(
    (await (await call(`/api/ideas?requestId=${requestId}`)).json()).request
      .status,
    "failed",
    "Expired running work must become recoverable.",
  );
  assert.equal(
    (await call("/api/ideas", "POST", { requestId, ...input })).status,
    409,
    "Retries are bounded.",
  );
  const initial = await (await call("/api/idea-draft")).json();
  assert.equal(initial.revision, 0);
  const draft = {
    ...emptyDraft,
    title: "How the internet works",
    summary: "Follow a web request.",
    sourceRequestId: requestId,
    sourceIndex: 0,
  };
  const first = { revision: 0, mutationId: randomUUID(), draft };
  assert.equal((await call("/api/idea-draft", "PUT", first)).status, 200);
  const replay = await (await call("/api/idea-draft", "PUT", first)).json();
  assert.equal(replay.revision, 1);
  const saves = await Promise.all([
    call("/api/idea-draft", "PUT", {
      revision: 1,
      mutationId: randomUUID(),
      draft: { ...draft, title: "Version A" },
    }),
    call("/api/idea-draft", "PUT", {
      revision: 1,
      mutationId: randomUUID(),
      draft: { ...draft, title: "Version B" },
    }),
  ]);
  assert.deepEqual(
    saves.map((response) => response.status).sort(),
    [200, 409],
    "One concurrent save must conflict.",
  );
  const current = await (await call("/api/idea-draft")).json();
  assert.equal(current.revision, 2);
  for (const [index, review] of [
    "approved",
    "pending",
    "dismissed",
  ].entries()) {
    assert.equal(
      (
        await call("/api/idea-draft", "PUT", {
          revision: 2 + index,
          mutationId: randomUUID(),
          draft: { ...current.draft, review },
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await call("/api/idea-draft")).json()).draft.review,
      review,
    );
  }
  const page = await call("/home/ideas");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Explore explainer ideas/);
  console.log(
    "PASS: auth/origin checks, ownership, durable request recovery/replay/leases, optimistic save races, review persistence, and protected page.",
  );
  if (process.argv.includes("--live")) {
    const response = await call("/api/ideas", "POST", {
      requestId: randomUUID(),
      ...input,
    });
    assert.equal(response.status, 200);
    const live = (await response.json()).request;
    assert.equal(
      live.status,
      "completed",
      live.error || "Live Gemini request did not complete.",
    );
    assert.ok(ideasOutputSchema.safeParse({ ideas: live.ideas }).success);
    console.log(
      "PASS: live Gemini produced six schema-valid ideas (one provider request).",
    );
  }
} finally {
  if (db) {
    if (!userId)
      userId = String(
        (await db.collection("user").findOne({ email }))?._id ?? "",
      );
    if (userId) {
      await db
        .collection("idea_requests")
        .deleteMany({ $or: [{ userId }, { userId: `foreign-${userId}` }] });
      await db.collection("idea_drafts").deleteMany({ userId });
      const ids = ObjectId.isValid(userId)
        ? [userId, new ObjectId(userId)]
        : [userId];
      await db.collection("session").deleteMany({ userId: { $in: ids } });
      await db.collection("account").deleteMany({ userId: { $in: ids } });
    }
    await db.collection("user").deleteMany({ email });
    await db
      .collection("rateLimit")
      .deleteMany({ key: { $regex: testIp.replaceAll(".", "\\.") } });
  }
  await client.close();
}
