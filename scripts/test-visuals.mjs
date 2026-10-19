import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import {
  normalizeVisual,
  composeVisual,
  escapeVisualText,
} from "../src/lib/visual-composition.ts";
import { processVisualStep } from "../src/lib/visual-worker.ts";
import {
  isCurrentVisualPlan,
  canApplyVisualState,
  visualSize,
} from "../src/lib/visuals.ts";

const planRequestId = randomUUID();
const form = {
  brief: {
    title: "TEST FIXTURE · Internet illustration",
    hook: "A visual testing fixture.",
    summary:
      "An educational fixture used only to verify the visual generation pipeline.",
  },
  config: {
    format: "image",
    duration: null,
    voice: null,
    language: "hi",
    visualStyle: "infographic",
  },
};
const plan = {
  title: "TEST FIXTURE · Browser and server",
  caption: "A test fixture, not a real provider result.",
  scenes: [
    {
      title: "TEST FIXTURE · Request and response",
      narration: "",
      visual:
        "An educational illustration of browser requests and web servers.",
      onScreenText: "इंटरनेट कैसे काम करता है?",
    },
  ],
};
const snapshot = { form, plan, revision: 1, planRequestId, planHash: "test" };
assert.ok(
  isCurrentVisualPlan(snapshot, {
    revision: 1,
    planning: { requestId: planRequestId, status: "completed" },
    plan,
  }),
);
assert.ok(
  !isCurrentVisualPlan(snapshot, {
    revision: 2,
    planning: { requestId: planRequestId, status: "completed" },
    plan,
  }),
);
assert.ok(
  !isCurrentVisualPlan(snapshot, {
    revision: 1,
    planning: { requestId: randomUUID(), status: "completed" },
    plan,
  }),
);
assert.ok(
  !canApplyVisualState(
    { revision: 1, planRequestId },
    { revision: 2, planRequestId },
  ),
);
assert.equal(escapeVisualText('<b>&"'), "&lt;b&gt;&amp;&quot;");
const fixture = await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#28243d" },
})
  .png()
  .toBuffer();
for (const format of ["reel", "image"]) {
  const size = visualSize(format);
  const art = await normalizeVisual(fixture, size.width, size.height);
  const composed = await composeVisual(
    art,
    "इंटरनेट कैसे काम करता है? <TEST & fixture>",
    size.width,
    size.height,
  );
  const meta = await sharp(composed).metadata();
  assert.equal(meta.width, size.width);
  assert.equal(meta.height, size.height);
  assert.equal(meta.format, "png");
  assert.notDeepEqual(
    art,
    composed,
    "Programmatic text must alter the raw artwork.",
  );
}
await assert.rejects(
  normalizeVisual(Buffer.from('<svg width="1080" height="1350"/>'), 1080, 1350),
);
let generated = 0,
  loaded = 0,
  checkpoints = [];
const work = {
  jobId: "unit",
  lease: "token",
  index: 0,
  snapshot,
  rawAssetId: "saved-raw",
  referenceAssetId: null,
  userId: "unit",
};
const deps = {
  claim: async () => work,
  current: async () => true,
  admit: async () => {},
  generate: async () => {
    generated++;
    return fixture;
  },
  load: async () => {
    loaded++;
    return fixture;
  },
  normalize: async (bytes) => bytes,
  compose: async (bytes) => bytes,
  save: async (_bytes, _work, variant) => variant,
  checkpoint: async (_work, assetId) => {
    checkpoints.push(assetId);
    return true;
  },
  discard: async () => {},
  cancel: async () => {},
  fail: async () => {},
};
await processVisualStep(deps);
assert.equal(
  generated,
  0,
  "A retry with checkpointed artwork must not generate again.",
);
assert.equal(loaded, 1);
assert.deepEqual(checkpoints, ["composition"]);
let cancelled = false,
  discarded = false;
await processVisualStep({
  ...deps,
  claim: async () => ({ ...work, rawAssetId: null }),
  checkpoint: async () => false,
  cancel: async () => {
    cancelled = true;
  },
  discard: async () => {
    discarded = true;
  },
});
assert.ok(
  cancelled && discarded,
  "A rejected stale checkpoint must discard unreferenced output.",
);
console.log(
  "PASS: plan identity, stale UI/worker guards, English/Hindi composition, dimensions, invalid-image rejection, and artwork checkpoint reuse.",
);
if (!process.argv.includes("--integration")) process.exit(0);

// Bundle the real server repository for Node without Next's server-only marker.
// Provider and R2 transport are injected. The production API has no fixture/mock flag.
// A private queue keeps the app's running worker away from synthetic test jobs.
const workspace = await mkdtemp(
  path.join(os.tmpdir(), "vidsutra-visual-test-"),
);
let userId = `visual-qa-${randomUUID()}`;
const email = `visual-http-${randomUUID()}@example.invalid`;
const testIp = `198.18.101.${Math.floor(Math.random() * 240) + 1}`;
let cookie;
async function http(
  path,
  method = "GET",
  body,
  authenticated = true,
  origin = process.env.BETTER_AUTH_URL,
) {
  return fetch(process.env.BETTER_AUTH_URL + path, {
    method,
    redirect: "manual",
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-forwarded-for": testIp,
      ...(authenticated && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
process.env.VISUAL_STORAGE = "r2";
process.env.VISUAL_GENERATION_ENABLED = "true";
process.env.R2_ACCOUNT_ID = "a".repeat(32);
process.env.R2_BUCKET_NAME = "test-fixtures";
process.env.R2_ACCESS_KEY_ID = "test-fixture-only";
process.env.R2_SECRET_ACCESS_KEY = "test-fixture-only";
process.env.VISUAL_WORKER_MODE = "node";
process.env.VISUAL_QUEUE = `qa-${randomUUID()}`;
process.env.GEMINI_IMAGE_MODEL = "test-fixture-only";
process.env.GEMINI_API_KEY ||= "test-fixture-only";
let server, db, storage;
const objects = new Map();
try {
  await symlink(
    path.join(process.cwd(), "node_modules"),
    path.join(workspace, "node_modules"),
    "dir",
  );
  await build({
    stdin: {
      contents:
        'export * from "./src/lib/server/visual-jobs"; export * from "./src/lib/server/content-creation"; export * from "./src/lib/server/mongodb"; export * from "./src/lib/server/errors"; export * from "./src/lib/server/visual-storage";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile: path.join(workspace, "server.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "server-only-test",
        setup(plugin) {
          plugin.onResolve({ filter: /^server-only$/ }, () => ({
            path: "empty",
            namespace: "test-marker",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "test-marker" }, () => ({
            contents: "export {};",
            loader: "js",
          }));
        },
      },
    ],
  });
  server = await import(pathToFileURL(path.join(workspace, "server.mjs")).href);
  db = await server.getDatabase();
  if (process.argv.includes("--http")) {
    assert.equal(new URL(process.env.BETTER_AUTH_URL).hostname, "127.0.0.1");
    const response = await http(
      "/api/auth/sign-up/email",
      "POST",
      {
        name: "Visual HTTP QA",
        email,
        password: `Qa-${randomUUID()}-${randomUUID()}`,
      },
      false,
    );
    assert.equal(response.status, 200);
    userId = (await response.json()).user.id;
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  }
  async function content(config = form.config, scenes = plan.scenes) {
    const item = await server.createContentItem(userId, {
      mode: "manual",
      creationId: randomUUID(),
      form: { ...form, config },
    });
    const id = randomUUID();
    await db.collection("content_items").updateOne(
      { _id: new ObjectId(item.id), userId },
      {
        $set: {
          plan: { ...plan, scenes },
          planning: {
            requestId: id,
            sourceRevision: 1,
            status: "completed",
            error: null,
            attempts: 1,
            lease: randomUUID(),
            leaseUntil: new Date(),
          },
        },
      },
    );
    return {
      id: item.id,
      body: { revision: 1, planRequestId: id, action: "start" },
    };
  }
  const client = new S3Client({
    region: "auto",
    endpoint: "https://r2.test.invalid",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: {
      async handle(request) {
        assert.equal(request.hostname, "r2.test.invalid");
        assert.ok(request.path.startsWith("/test-fixtures/visuals/"));
        assert.equal(request.headers["x-amz-acl"], undefined);
        const key = request.path;
        if (request.method === "PUT") {
          assert.equal(request.headers["cache-control"], "private, no-store");
          assert.equal(request.headers["content-type"], "image/png");
          const chunks = [];
          if (request.body instanceof Uint8Array)
            chunks.push(Buffer.from(request.body));
          else
            for await (const chunk of request.body)
              chunks.push(Buffer.from(chunk));
          objects.set(key, Buffer.concat(chunks));
        } else if (request.method === "DELETE") objects.delete(key);
        else assert.equal(request.method, "GET");
        const bytes =
          request.method === "GET" ? objects.get(key) : Buffer.alloc(0);
        assert.ok(bytes, "R2 object must exist");
        return {
          response: {
            statusCode: request.method === "DELETE" ? 204 : 200,
            headers: {
              "content-type": "image/png",
              "content-length": String(bytes.length),
            },
            body: Readable.from([bytes]),
          },
        };
      },
    },
  });
  storage = server.createR2ObjectStore(client, "test-fixtures");
  const base = server.createVisualWorkerDependencies({ storage });
  let providerCalls = 0,
    references = 0;
  const mock = {
    ...base,
    generate: async (_work, reference) => {
      providerCalls++;
      if (reference) references++;
      return fixture;
    },
  };
  const target = await content();
  process.env.VISUAL_GENERATION_ENABLED = "false";
  await assert.rejects(
    server.enqueueVisuals(userId, target.id, target.body),
    /generation is paused/,
  );
  await assert.rejects(base.admit({ userId }), /generation is paused/);
  process.env.VISUAL_GENERATION_ENABLED = "true";
  const configuredBucket = process.env.R2_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  await assert.rejects(
    server.enqueueVisuals(userId, target.id, target.body),
    /R2 storage needs/,
  );
  process.env.R2_BUCKET_NAME = configuredBucket;
  const duplicates = await Promise.all([
    server.enqueueVisuals(userId, target.id, target.body),
    server.enqueueVisuals(userId, target.id, target.body),
  ]);
  assert.equal(duplicates[0].batch.id, duplicates[1].batch.id);
  assert.equal(
    await db.collection("generation_jobs").countDocuments({
      userId,
      contentItemId: new ObjectId(target.id),
      kind: "visuals",
    }),
    1,
  );
  await assert.rejects(
    server.getVisualState("foreign-account", target.id),
    /not found/,
  );
  await assert.rejects(
    server.enqueueVisuals(userId, target.id, { ...target.body, revision: 2 }),
    /plan changed/,
  );
  await processVisualStep(mock);
  let state = await server.getVisualState(userId, target.id);
  assert.equal(state.batch.status, "completed");
  assert.equal(state.batch.completed, 1);
  const firstAsset = state.batch.scenes[0].assetId;
  const bytes = await base.load(firstAsset, userId);
  assert.equal((await sharp(bytes).metadata()).height, 1350);
  await assert.rejects(
    server.getVisualAsset("foreign-account", firstAsset),
    /not found/,
  );
  if (process.argv.includes("--http")) {
    const apiPath = `/api/content/${target.id}/visuals`;
    assert.equal((await http(apiPath, "GET", undefined, false)).status, 401);
    assert.equal((await http(apiPath, "POST", target.body, false)).status, 401);
    assert.equal(
      (
        await http(
          apiPath,
          "POST",
          target.body,
          true,
          "https://foreign.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await http(apiPath, "POST", { ...target.body, revision: 5 })).status,
      409,
    );
    const replay = await http(apiPath, "POST", target.body);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).batch.status, "completed");
    // Byte round trips use the private SDK transport above; HTTP tests never contact R2.
    assert.equal(
      (await http(`/api/media/${firstAsset}`, "GET", undefined, false)).status,
      401,
    );
    assert.equal((await http(`/api/media/${new ObjectId()}`)).status, 404);
    assert.equal((await http("/api/internal/visual-worker")).status, 401);
    assert.equal(
      (await http(`/api/content/${new ObjectId()}/visuals`)).status,
      404,
    );
    console.log(
      "PASS: authenticated visual status/replay, stale plan/origin rejection, private ownership checks, and protected worker dispatch over HTTP.",
    );
  }
  await server.enqueueVisuals(userId, target.id, target.body);
  assert.equal(providerCalls, 1, "Completed replay must not spend again.");
  const reelConfig = {
    format: "reel",
    duration: 30,
    voice: "viraj",
    language: "en",
    visualStyle: "infographic",
  };
  const scenes = Array.from({ length: 4 }, (_, index) => ({
    ...plan.scenes[0],
    title: `TEST FIXTURE · Scene ${index + 1}`,
    narration: "A browser asks a server for information.",
  }));
  const partial = await content(reelConfig, scenes);
  await server.enqueueVisuals(userId, partial.id, partial.body);
  await processVisualStep(mock);
  state = await server.getVisualState(userId, partial.id);
  const completedAsset = state.batch.scenes[0].assetId;
  await processVisualStep({
    ...mock,
    compose: async () => {
      throw new Error("Synthetic compositor interruption");
    },
  });
  state = await server.getVisualState(userId, partial.id);
  assert.equal(state.batch.status, "failed");
  assert.equal(state.batch.completed, 1);
  const callsBeforeRetry = providerCalls;
  await db
    .collection("generation_jobs")
    .updateOne({ _id: state.batch.id }, { $set: { retryAt: new Date(0) } });
  await server.enqueueVisuals(userId, partial.id, {
    ...partial.body,
    action: "retry",
  });
  await processVisualStep(mock);
  assert.equal(
    providerCalls,
    callsBeforeRetry,
    "Checkpointed artwork avoids a second provider call on composition retry.",
  );
  state = await server.getVisualState(userId, partial.id);
  assert.equal(state.batch.scenes[0].assetId, completedAsset);
  assert.equal(state.batch.completed, 2);
  while (await processVisualStep(mock)) {
    /* Drain only this run's private queue. */
  }
  state = await server.getVisualState(userId, partial.id);
  assert.equal(state.batch.completed, 4);
  assert.ok(
    references >= 1,
    "Later scenes use the first illustration as a style reference.",
  );
  const stale = await content();
  await server.enqueueVisuals(userId, stale.id, stale.body);
  const held = await base.claim();
  assert.ok(held);
  await server.updateContentItem(userId, stale.id, {
    revision: 1,
    mutationId: randomUUID(),
    form: {
      ...form,
      brief: { ...form.brief, title: "Changed while generation was in flight" },
    },
  });
  assert.equal(
    await base.checkpoint(held, firstAsset, "composition"),
    false,
    "A late worker must not attach output to an edited plan.",
  );
  assert.equal(
    (await db.collection("generation_jobs").findOne({ _id: held.jobId }))
      .status,
    "cancelled",
  );
  const interrupted = await content();
  await server.enqueueVisuals(userId, interrupted.id, interrupted.body);
  const active = await base.claim();
  await db
    .collection("generation_jobs")
    .updateOne({ _id: active.jobId }, { $set: { leaseUntil: new Date(0) } });
  state = await server.getVisualState(userId, interrupted.id);
  assert.equal(state.batch.status, "failed");
  assert.ok(state.batch.canRetry);
  assert.equal(
    await base.checkpoint(active, firstAsset, "composition"),
    false,
    "Expired leases cannot commit.",
  );
  await base.claim(); // Marks the expired job failed, without another paid call.
  await server.enqueueVisuals(userId, interrupted.id, {
    ...interrupted.body,
    action: "retry",
  });
  const beforeFailure = providerCalls;
  await processVisualStep({
    ...mock,
    generate: async () => {
      throw new server.IdeaError("Synthetic provider quota failure", 429);
    },
  });
  state = await server.getVisualState(userId, interrupted.id);
  assert.equal(state.batch.status, "failed");
  assert.match(state.batch.error, /quota/);
  assert.equal(providerCalls, beforeFailure);
  await assert.rejects(
    server.enqueueVisuals(userId, interrupted.id, {
      ...interrupted.body,
      action: "retry",
    }),
    /cooldown/,
  );
  const key = `visual_budget:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
  await db
    .collection("app_settings")
    .updateOne({ key }, { $set: { used: 24 } }, { upsert: true });
  const capped = await content();
  await server.enqueueVisuals(userId, capped.id, capped.body);
  await processVisualStep(mock);
  state = await server.getVisualState(userId, capped.id);
  assert.match(state.batch.error, /hourly illustration limit/);
  console.log(
    "PASS: real MongoDB persistence with mock R2 SDK transport, atomic leases/checkpoints, duplicate starts, partial retry, style references, stale plan fencing, interruption recovery, ownership, provider failure, cooldowns, and admission ceiling. No provider calls.",
  );
} finally {
  if (db) {
    const assets = await db
      .collection("media_assets")
      .find({ userId })
      .toArray();
    for (const asset of assets)
      await server.discardVisual(asset._id.toString(), userId, storage);
    if (process.argv.includes("--http")) {
      const ids = ObjectId.isValid(userId)
        ? [userId, new ObjectId(userId)]
        : [userId];
      await db.collection("session").deleteMany({ userId: { $in: ids } });
      await db.collection("account").deleteMany({ userId: { $in: ids } });
      await db.collection("user").deleteMany({ email });
      await db
        .collection("rateLimit")
        .deleteMany({ key: { $regex: testIp.replaceAll(".", "\\.") } });
    }
    await db.collection("generation_jobs").deleteMany({ userId });
    await db.collection("content_items").deleteMany({ userId });
    await db
      .collection("app_settings")
      .deleteMany({ key: { $regex: `^visual_budget:${userId}:` } });
  }
  assert.equal(objects.size, 0, "Fixture objects must be cleaned up");
  if (server) await (await server.getMongoClient()).close();
  await rm(workspace, { recursive: true, force: true });
}
