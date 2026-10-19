import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";
import {
  contentConfigSchema,
  contentFormSchema,
  contentRecoverySchema,
  defaultConfig,
  sceneCount,
  validateContentPlan,
} from "../src/lib/content-creation.ts";

const form = {
  brief: {
    title: "How does the internet work?",
    hook: "One click starts a global journey.",
    summary:
      "Explain how a browser sends a request to a server, how data travels in packets, and how the browser assembles the response.",
  },
  config: defaultConfig,
};
const image = {
  format: "image",
  language: "hi",
  duration: null,
  voice: null,
  visualStyle: "infographic",
};
const planFor = (config) => ({
  title: "A web request, explained",
  caption: "A little curiosity changes the way we see the internet.",
  scenes: Array.from({ length: sceneCount(config) }, (_, i) => ({
    title: `The next step ${i + 1}`,
    narration:
      config.format === "image"
        ? ""
        : "Your browser asks a web server for information.",
    visual:
      "An illustrated diagram connects a browser and server with moving packets.",
    onScreenText: "Request → Response",
  })),
});
assert.ok(contentFormSchema.safeParse(form).success);
assert.ok(contentConfigSchema.safeParse(image).success);
assert.ok(!contentConfigSchema.safeParse({ ...image, voice: "viraj" }).success);
assert.ok(
  !contentConfigSchema.safeParse({ ...defaultConfig, voice: "other" }).success,
);
assert.ok(
  !contentConfigSchema.safeParse({ ...defaultConfig, duration: 45 }).success,
);
assert.ok(
  contentRecoverySchema.safeParse({
    ...form,
    brief: { title: "", hook: "", summary: "" },
  }).success,
);
assert.ok(
  !contentFormSchema.safeParse({
    ...form,
    brief: { title: "", hook: "", summary: "" },
  }).success,
);
for (const duration of [30, 60, 90]) {
  const config = { ...defaultConfig, duration };
  assert.equal(
    validateContentPlan(planFor(config), config).scenes.length,
    duration === 30 ? 4 : duration === 60 ? 6 : 8,
  );
}
validateContentPlan(planFor(image), image);
assert.throws(() => validateContentPlan(planFor(defaultConfig), image));
assert.throws(() =>
  validateContentPlan(
    {
      ...planFor(image),
      scenes: [{ ...planFor(image).scenes[0], narration: "Unexpected audio" }],
    },
    image,
  ),
);
console.log(
  "PASS: approved voices, supported durations, image-only settings, partial draft recovery, and format-specific plans.",
);
if (!process.argv.includes("--integration")) process.exit(0);

const origin = process.env.BETTER_AUTH_URL;
assert.equal(new URL(origin).hostname, "127.0.0.1");
const client = new MongoClient(getMongoConfig().uri, {
  serverSelectionTimeoutMS: 15_000,
});
const email = `content-qa-${randomUUID()}@example.invalid`;
const ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
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
      "x-forwarded-for": ip,
      "Content-Type": "application/json",
      ...(authenticated && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  await client.connect();
  db = client.db(getMongoConfig().databaseName);
  const signup = await call(
    "/api/auth/sign-up/email",
    "POST",
    {
      name: "Content QA",
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
  userId = (await signup.json()).user.id;
  const manual = { mode: "manual", creationId: randomUUID(), form };
  assert.equal((await call("/api/content", "POST", manual, false)).status, 401);
  assert.equal(
    (
      await call(
        "/api/content",
        "POST",
        manual,
        true,
        "https://foreign.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/content", "POST", {
        ...manual,
        form: { ...form, config: { ...defaultConfig, voice: "other" } },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/content", "POST", {
        mode: "idea",
        creationId: randomUUID(),
        ideaRevision: 1,
      })
    ).status,
    409,
  );
  const ideaMutation = randomUUID();
  await db
    .collection("idea_drafts")
    .insertOne({
      _id: userId,
      userId,
      revision: 1,
      mutationId: ideaMutation,
      draft: {
        ...form.brief,
        format: "reel",
        language: "hi",
        review: "approved",
        sourceRequestId: null,
        sourceIndex: null,
      },
      updatedAt: new Date(),
    });
  const fromIdea = { mode: "idea", creationId: ideaMutation, ideaRevision: 1 };
  const handoffs = await Promise.all([
    call("/api/content", "POST", fromIdea),
    call("/api/content", "POST", fromIdea),
  ]);
  const handoffItems = await Promise.all(
    handoffs.map(async (response) => {
      assert.equal(response.status, 200);
      return (await response.json()).item;
    }),
  );
  assert.equal(
    handoffItems[0].id,
    handoffItems[1].id,
    "Double-click/lost-response handoff must be idempotent.",
  );
  assert.equal(handoffItems[0].form.config.language, "hi");
  assert.equal(
    (
      await call("/api/content", "POST", {
        ...fromIdea,
        ideaRevision: 2,
        creationId: randomUUID(),
      })
    ).status,
    409,
  );
  const response = await call("/api/content", "POST", manual);
  assert.equal(response.status, 200);
  const item = (await response.json()).item;
  const path = `/api/content/${item.id}`;
  assert.equal((await call(path, "GET", undefined, false)).status, 401);
  assert.equal(
    (
      await call(
        path + "/plan",
        "POST",
        { requestId: randomUUID(), revision: 1 },
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        path + "/plan",
        "POST",
        { requestId: randomUUID(), revision: 1 },
        true,
        "https://foreign.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(path, "PUT", {}, true, "https://foreign.invalid")).status,
    403,
  );
  assert.equal((await call("/api/content/not-an-id")).status, 404);
  const foreign = await db
    .collection("content_items")
    .insertOne({
      userId: `foreign-${userId}`,
      form,
      creationId: randomUUID(),
      revision: 1,
    });
  assert.equal((await call(`/api/content/${foreign.insertedId}`)).status, 404);
  assert.equal(
    (
      await call(`/api/content/${foreign.insertedId}`, "PUT", {
        revision: 1,
        mutationId: randomUUID(),
        form,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(`/api/content/${foreign.insertedId}/plan`, "POST", {
        revision: 1,
        requestId: randomUUID(),
      })
    ).status,
    404,
  );
  const replay = await (await call("/api/content", "POST", manual)).json();
  assert.equal(replay.item.id, item.id);
  assert.equal(
    (
      await call("/api/content", "POST", {
        ...manual,
        form: {
          ...form,
          brief: { ...form.brief, title: "Different creation" },
        },
      })
    ).status,
    409,
  );
  const writes = await Promise.all([
    call(path, "PUT", {
      revision: 1,
      mutationId: randomUUID(),
      form: { ...form, brief: { ...form.brief, title: "Draft A" } },
    }),
    call(path, "PUT", {
      revision: 1,
      mutationId: randomUUID(),
      form: { ...form, brief: { ...form.brief, title: "Draft B" } },
    }),
  ]);
  assert.deepEqual(
    writes.map((response) => response.status).sort(),
    [200, 409],
  );
  let latest = (await (await call(path)).json()).item;
  assert.equal(latest.revision, 2);
  const mutation = randomUUID();
  const update = { revision: 2, mutationId: mutation, form };
  assert.equal((await call(path, "PUT", update)).status, 200);
  assert.equal(
    (await (await call(path, "PUT", update)).json()).item.revision,
    3,
  );
  const planId = randomUUID();
  const lease = randomUUID();
  await db
    .collection("content_items")
    .updateOne(
      { _id: new ObjectId(item.id), userId },
      {
        $set: {
          plan: planFor(defaultConfig),
          planning: {
            requestId: planId,
            sourceRevision: 3,
            status: "completed",
            error: null,
            lease,
            leaseUntil: new Date(),
            attempts: 1,
          },
        },
      },
    );
  assert.equal(
    (
      await (
        await call(path + "/plan", "POST", { revision: 3, requestId: planId })
      ).json()
    ).item.plan.scenes.length,
    6,
  );
  assert.equal(
    (
      await db
        .collection("content_items")
        .findOne({ _id: new ObjectId(item.id) })
    ).planning.attempts,
    1,
    "Replay cannot call Gemini again.",
  );
  await db
    .collection("content_items")
    .updateOne(
      { _id: new ObjectId(item.id) },
      {
        $set: {
          "planning.status": "running",
          "planning.leaseUntil": new Date(Date.now() + 60_000),
          plan: null,
        },
      },
    );
  assert.equal(
    (
      await call(path + "/plan", "POST", {
        revision: 3,
        requestId: randomUUID(),
      })
    ).status,
    202,
    "Concurrent requests share the active lease.",
  );
  await db
    .collection("content_items")
    .updateOne(
      { _id: new ObjectId(item.id) },
      { $set: { "planning.leaseUntil": new Date(0), "planning.attempts": 3 } },
    );
  assert.equal(
    (await (await call(path)).json()).item.planning.status,
    "failed",
  );
  assert.equal(
    (await call(path + "/plan", "POST", { revision: 3, requestId: planId }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(path + "/plan", "POST", {
        revision: 2,
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(path, "PUT", {
        revision: 3,
        mutationId: randomUUID(),
        form: { ...form, config: image },
      })
    ).status,
    200,
  );
  latest = (await (await call(path)).json()).item;
  assert.equal(latest.planning, null);
  assert.equal(latest.plan, null);
  assert.equal(latest.form.config.voice, null);
  const late = await db
    .collection("content_items")
    .updateOne(
      {
        _id: new ObjectId(item.id),
        userId,
        revision: 3,
        "planning.lease": lease,
      },
      { $set: { plan: planFor(defaultConfig) } },
    );
  assert.equal(
    late.modifiedCount,
    0,
    "A stale worker result cannot overwrite edited settings.",
  );
  const dashboard = await (await call("/api/dashboard")).json();
  assert.ok(
    dashboard.recentContent.some(
      (content) => content.id === item.id && content.editable,
    ),
  );
  assert.equal(
    (await call("/home/create", "GET", undefined, false)).status,
    307,
  );
  const page = await call(`/home/create/${item.id}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Create an image post/);
  const budgetKey = `planning_budget:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
  await db
    .collection("app_settings")
    .updateOne({ key: budgetKey }, { $set: { used: 12 } }, { upsert: true });
  const limited = await (
    await call(path + "/plan", "POST", { revision: 4, requestId: randomUUID() })
  ).json();
  assert.equal(limited.item.planning.status, "failed");
  assert.match(limited.item.planning.error, /hourly planning limit/);
  assert.equal(limited.item.plan, null);
  await db.collection("app_settings").deleteOne({ key: budgetKey });
  console.log(
    "PASS: approved-idea handoff, creation/save replay, ownership/origin protection, concurrent edits, stale plan invalidation, recovery leases, dashboard links, and protected composer.",
  );
  if (process.argv.includes("--live")) {
    for (const config of [defaultConfig, image]) {
      const created = (
        await (
          await call("/api/content", "POST", {
            mode: "manual",
            creationId: randomUUID(),
            form: { ...form, config },
          })
        ).json()
      ).item;
      const started = Date.now();
      const result = await call(`/api/content/${created.id}/plan`, "POST", {
        revision: 1,
        requestId: randomUUID(),
      });
      assert.equal(result.status, 200);
      const planned = (await result.json()).item;
      assert.equal(
        planned.planning.status,
        "completed",
        planned.planning.error || "Planning did not complete.",
      );
      validateContentPlan(planned.plan, config);
      console.log(
        `PASS: live ${config.format} plan persisted in ${Math.round((Date.now() - started) / 1000)} seconds.`,
      );
    }
  }
} finally {
  if (db) {
    const user = await db.collection("user").findOne({ email });
    if (!userId && user) userId = String(user._id);
    if (userId) {
      await db
        .collection("content_items")
        .deleteMany({ userId: { $in: [userId, `foreign-${userId}`] } });
      await db.collection("idea_drafts").deleteMany({ userId });
      await db
        .collection("app_settings")
        .deleteMany({ key: { $regex: `^planning_budget:${userId}:` } });
      const ids = ObjectId.isValid(userId)
        ? [userId, new ObjectId(userId)]
        : [userId];
      await db.collection("session").deleteMany({ userId: { $in: ids } });
      await db.collection("account").deleteMany({ userId: { $in: ids } });
    }
    await db.collection("user").deleteMany({ email });
    await db
      .collection("rateLimit")
      .deleteMany({ key: { $regex: ip.replaceAll(".", "\\.") } });
  }
  await client.close();
}
