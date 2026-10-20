import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { ObjectId } from "mongodb";
import { S3Client } from "@aws-sdk/client-s3";
import { build } from "esbuild";
import {
  alignNarration,
  captionFile,
  narrationText,
  approvedNarrationVoices,
} from "../src/lib/narration.ts";
import { audioByteRange } from "../src/lib/audio-range.ts";
import { processNarrationStep } from "../src/lib/narration-worker.ts";
const tone = await readFile(
  new URL("./fixtures/narration-tone.mp3", import.meta.url),
);
const form = {
  brief: {
    title: "TEST FIXTURE · Narration",
    hook: "Synthetic audio test",
    summary: "A synthetic narration fixture used only for testing.",
  },
  config: {
    format: "reel",
    duration: 30,
    voice: "viraj",
    language: "en",
    visualStyle: "infographic",
  },
};
function planFor(language = "en") {
  return {
    title: "TEST FIXTURE · Caption alignment",
    caption:
      "Synthetic fixture; the audio is a test tone, not generated speech.",
    scenes: ["Opening", "Request", "Response", "Conclusion"].map(
      (title, i) => ({
        title,
        narration:
          language === "hi"
            ? [
                "नमस्ते दुनिया।",
                "ब्राउज़र अनुरोध भेजता है।",
                "सर्वर जवाब देता है।",
                "अब कहानी पूरी हुई।",
              ][i]
            : [
                "Hello world.",
                "Browsers send requests.",
                "Servers send responses.",
                "That completes the story.",
              ][i],
        visual: "A clearly labeled synthetic diagram.",
        onScreenText: title,
      }),
    ),
  };
}
function speechFor(plan) {
  const characters = [...narrationText(plan)],
    step = 3 / characters.length;
  return {
    audio: tone,
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => 0.1 + i * step),
      character_end_times_seconds: characters.map(
        (_, i) => 0.1 + (i + 1) * step,
      ),
    },
    normalizedAlignment: null,
  };
}
for (const language of ["en", "hi"]) {
  const plan = planFor(language),
    speech = speechFor(plan),
    timing = alignNarration(plan, speech, 4.05);
  assert.equal(timing.scenes.length, 4);
  assert.equal(timing.scenes[0].from, 0);
  assert.equal(timing.scenes.at(-1).to, timing.totalFrames);
  assert.equal(timing.words.map((w) => w.text).join(" "), narrationText(plan));
  for (let i = 1; i < timing.scenes.length; i++)
    assert.equal(timing.scenes[i].from, timing.scenes[i - 1].to);
  assert.match(captionFile(timing, "srt"), /00:00:00,100 -->/);
  assert.ok(captionFile(timing, "vtt").startsWith("WEBVTT\n\n"));
  const bad = structuredClone(speech);
  bad.alignment.characters[0] = "WRONG";
  assert.throws(() => alignNarration(plan, bad, 4.05), /do not match/);
  assert.deepEqual(
    alignNarration(
      plan,
      { alignment: bad.alignment, normalizedAlignment: speech.alignment },
      4.05,
    ),
    timing,
  );
  const missing = structuredClone(speech);
  missing.alignment.character_end_times_seconds.pop();
  assert.throws(() => alignNarration(plan, missing, 4.05), /lengths/);
  const backwards = structuredClone(speech);
  backwards.alignment.character_start_times_seconds[3] = -1;
  assert.throws(
    () => alignNarration(plan, backwards, 4.05),
    /Invalid character/,
  );
  assert.throws(() => alignNarration(plan, speech, 1), /beyond/);
}
assert.throws(
  () => narrationText({ scenes: [{ narration: "" }] }),
  /Every Reel/,
);
assert.throws(
  () => narrationText({ scenes: [{ narration: "a".repeat(8001) }] }),
  /8,000/,
);
assert.deepEqual(audioByteRange("bytes=2-5", 10), { start: 2, end: 5 });
assert.deepEqual(audioByteRange("bytes=-3", 10), { start: 7, end: 9 });
assert.deepEqual(audioByteRange("bytes=5-", 10), { start: 5, end: 9 });
for (const header of [
  "bytes=10-",
  "bytes=-0",
  "bytes=5-2",
  "bytes=0-1,3-4",
  "bytes=-",
  "bad",
])
  assert.equal(audioByteRange(header, 10), "invalid");
const plan = planFor(),
  speech = speechFor(plan),
  snapshot = {
    form,
    plan,
    revision: 1,
    planRequestId: randomUUID(),
    planHash: "fixture",
  };
let calls = 0,
  discarded = 0,
  cancelled = 0,
  failed = 0;
const work = {
  jobId: "test",
  lease: "test",
  userId: "test",
  contentId: "test",
  snapshot,
  voice: "viraj",
  sourceAssetId: "saved",
};
const deps = {
  claim: async () => work,
  current: async () => true,
  admit: async () => {
    calls++;
  },
  generate: async () => {
    calls++;
    return speech;
  },
  measure: async () => 4.05,
  save: async () => "saved",
  load: async () => ({ ...speech, duration: 4.05 }),
  checkpoint: async () => true,
  align: (w, s) => alignNarration(w.snapshot.plan, s, s.duration),
  complete: async () => true,
  discard: async () => {
    discarded++;
  },
  cancel: async () => {
    cancelled++;
  },
  fail: async () => {
    failed++;
  },
};
await processNarrationStep(deps);
assert.equal(calls, 0, "Checkpoint retries must not admit or generate speech");
await processNarrationStep({
  ...deps,
  claim: async () => ({ ...work, sourceAssetId: null }),
  checkpoint: async () => false,
});
assert.equal(discarded, 1);
assert.equal(cancelled, 1);
assert.equal(failed, 0);
console.log(
  "PASS: English/Hindi word and scene alignment, frame coverage, SRT/VTT, malformed timing rejection, private audio byte ranges, checkpoint reuse, and stale checkpoint discard.",
);

const workspace = await mkdtemp(path.join(os.tmpdir(), "vidsutra-narration-"));
let server,
  db,
  storage,
  userId = `narration-qa-${randomUUID()}`,
  cookie;
const objects = new Map(),
  email = `narration-http-${randomUUID()}@example.invalid`,
  testIp = "198.18.103.97";
async function http(
  url,
  method = "GET",
  body,
  auth = true,
  origin = process.env.BETTER_AUTH_URL,
) {
  return fetch(process.env.BETTER_AUTH_URL + url, {
    method,
    redirect: "manual",
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-forwarded-for": testIp,
      ...(auth && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  await symlink(
    path.join(process.cwd(), "node_modules"),
    path.join(workspace, "node_modules"),
    "dir",
  );
  await build({
    stdin: {
      contents:
        'export * from "./src/lib/server/narration-jobs";export * from "./src/lib/server/elevenlabs-narration";export * from "./src/lib/server/narration-config";export * from "./src/lib/server/content-creation";export * from "./src/lib/server/mongodb";export * from "./src/lib/server/visual-storage";export * from "./src/lib/server/errors";',
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
        name: "server-marker",
        setup(p) {
          p.onResolve({ filter: /^server-only$/ }, () => ({
            path: "empty",
            namespace: "test",
          }));
          p.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents: "export {};",
            loader: "js",
          }));
        },
      },
    ],
  });
  server = await import(pathToFileURL(path.join(workspace, "server.mjs")));
  const duration = await server.measureNarrationAudio(tone);
  assert.ok(duration >= 4 && duration < 4.2);
  await assert.rejects(
    server.measureNarrationAudio(Buffer.alloc(1000)),
    /valid MP3/,
  );
  process.env.NARRATION_GENERATION_ENABLED = "true";
  process.env.ELEVENLABS_API_KEY = "fixture-only";
  const mockFetch = async (url, options) => {
    assert.equal(options.method, "POST");
    assert.ok(url.includes(approvedNarrationVoices.monika));
    const body = JSON.parse(options.body);
    assert.equal(body.model_id, "eleven_multilingual_v2");
    assert.equal(body.text, narrationText(plan));
    return Response.json({
      audio_base64: tone.toString("base64"),
      alignment: speech.alignment,
    });
  };
  assert.equal(
    (await server.generateNarration("monika", narrationText(plan), mockFetch))
      .audio.length,
    tone.length,
  );
  await assert.rejects(
    server.generateNarration(
      "viraj",
      "fixture",
      async () => new Response(null, { status: 429 }),
    ),
    /credits/,
  );
  await assert.rejects(
    server.generateNarration("viraj", "fixture", async () =>
      Response.json({ audio_base64: "invalid!" }),
    ),
    /invalid audio|incomplete narration/,
  );
  let reads = 0;
  await server.checkNarrationAccess("viraj", 20, async () => {
    reads++;
    return reads === 1
      ? new Response(null, { status: 200 })
      : Response.json({ character_count: 5, character_limit: 100 });
  });
  assert.equal(reads, 2);
  reads = 0;
  await assert.rejects(
    server.checkNarrationAccess("viraj", 20, async () =>
      ++reads === 1
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 401 }),
    ),
    /subscription-read/,
  );
  reads = 0;
  await assert.rejects(
    server.checkNarrationAccess("viraj", 200, async () =>
      ++reads === 1
        ? new Response(null, { status: 200 })
        : Response.json({ character_count: 5, character_limit: 100 }),
    ),
    /allowance/,
  );
  process.env.NARRATION_GENERATION_ENABLED = "false";
  await assert.rejects(
    server.generateNarration("viraj", "fixture", async () => {
      throw Error("Must never call provider");
    }),
    /paused/,
  );
  console.log(
    "PASS: real MP3 duration measurement, approved voice/provider request, credit preflight, subscription-permission failure, provider error sanitization, and paused-generation gate using mock HTTP only.",
  );
  if (process.argv.includes("--integration")) {
    process.env.NARRATION_GENERATION_ENABLED = "true";
    process.env.VISUAL_STORAGE = "r2";
    process.env.VISUAL_WORKER_MODE = "node";
    process.env.VISUAL_QUEUE = `qa-narration-${randomUUID()}`;
    process.env.R2_ACCOUNT_ID = "a".repeat(32);
    process.env.R2_BUCKET_NAME = "narration-fixtures";
    process.env.R2_ACCESS_KEY_ID = "fixture";
    process.env.R2_SECRET_ACCESS_KEY = "fixture";
    process.env.ELEVENLABS_VOICE_VIRAJ_ENERGETIC_CONFIDENT =
      approvedNarrationVoices.viraj;
    process.env.ELEVENLABS_VOICE_MONIKA_DEEP_NATURAL =
      approvedNarrationVoices.monika;
    db = await server.getDatabase();
    if (process.argv.includes("--http")) {
      assert.equal(new URL(process.env.BETTER_AUTH_URL).hostname, "127.0.0.1");
      const response = await http(
        "/api/auth/sign-up/email",
        "POST",
        {
          name: "Narration QA · TEST FIXTURE",
          email,
          password: `Qa-${randomUUID()}-${randomUUID()}`,
        },
        false,
      );
      assert.equal(response.status, 200);
      userId = (await response.json()).user.id;
      cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
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
          assert.ok(request.path.startsWith("/narration-fixtures/narration/"));
          assert.equal(request.headers["x-amz-acl"], undefined);
          if (request.method === "PUT") {
            assert.equal(request.headers["content-type"], "audio/mpeg");
            assert.equal(request.headers["cache-control"], "private, no-store");
            objects.set(request.path, Buffer.from(request.body));
          } else if (request.method === "DELETE") objects.delete(request.path);
          else assert.equal(request.method, "GET");
          const bytes =
            request.method === "GET"
              ? objects.get(request.path)
              : Buffer.alloc(0);
          assert.ok(bytes);
          return {
            response: {
              statusCode: request.method === "DELETE" ? 204 : 200,
              headers: {
                "content-length": String(bytes.length),
                "content-type": "audio/mpeg",
              },
              body: Readable.from([bytes]),
            },
          };
        },
      },
    });
    storage = server.createR2ObjectStore(client, "narration-fixtures");
    let generated = 0,
      accessChecks = 0;
    const base = server.createNarrationWorkerDependencies({
      storage,
      checkAccess: async () => {
        accessChecks++;
      },
    });
    const mock = {
      ...base,
      generate: async (w) => {
        generated++;
        return speechFor(w.snapshot.plan);
      },
    };
    async function content(config = form.config) {
      const item = await server.createContentItem(userId, {
          mode: "manual",
          creationId: randomUUID(),
          form: { ...form, config },
        }),
        requestId = randomUUID();
      await db.collection("content_items").updateOne(
        { _id: new ObjectId(item.id), userId },
        {
          $set: {
            plan: planFor(config.language),
            planning: {
              requestId,
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
        body: { revision: 1, planRequestId: requestId, action: "start" },
      };
    }
    const target = await content();
    process.env.NARRATION_GENERATION_ENABLED = "false";
    await assert.rejects(
      server.enqueueNarration(userId, target.id, target.body),
      /paused/,
    );
    process.env.NARRATION_GENERATION_ENABLED = "true";
    await assert.rejects(
      server.enqueueNarration("foreign", target.id, target.body),
      /not found/,
    );
    await assert.rejects(
      server.enqueueNarration(userId, target.id, {
        ...target.body,
        revision: 2,
      }),
      /plan changed/,
    );
    const duplicates = await Promise.all([
      server.enqueueNarration(userId, target.id, target.body),
      server.enqueueNarration(userId, target.id, target.body),
    ]);
    assert.equal(duplicates[0].job.id, duplicates[1].job.id);
    const claims = await Promise.all([base.claim(), base.claim()]);
    assert.equal(
      claims.filter(Boolean).length,
      1,
      "Only one worker can claim a narration job",
    );
    await processNarrationStep({
      ...mock,
      claim: async () => claims.find(Boolean),
    });
    let state = await server.getNarrationState(userId, target.id);
    assert.equal(state.job.status, "completed");
    assert.equal(state.job.timing.scenes.length, 4);
    assert.equal(generated, 1);
    const asset = await server.getNarrationAsset(
      userId,
      state.job.audioAssetId,
    );
    assert.deepEqual(await storage.read(asset.storage), tone);
    assert.ok(!JSON.stringify(state).includes("character_start_times"));
    assert.ok(!JSON.stringify(state).includes("narration-fixtures"));
    await assert.rejects(
      server.getNarrationAsset("foreign", state.job.audioAssetId),
      /not found/,
    );
    await server.enqueueNarration(userId, target.id, target.body);
    assert.equal(await processNarrationStep(mock), false);
    assert.equal(generated, 1);
    if (process.argv.includes("--http")) {
      const url = `/api/content/${target.id}/narration`;
      assert.equal((await http(url, "GET", null, false)).status, 401);
      assert.equal(
        (await http(url, "POST", target.body, true, "https://foreign.invalid"))
          .status,
        403,
      );
      assert.equal(
        (await http(url, "POST", { ...target.body, revision: 2 })).status,
        409,
      );
      assert.equal((await http(url, "POST", target.body)).status, 200);
      for (const format of ["srt", "vtt"]) {
        const response = await http(`${url}/captions?format=${format}`);
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.match(response.headers.get("content-disposition"), /attachment/);
        assert.match(await response.text(), /Hello world/);
      }
      assert.equal((await http(`${url}/captions?format=html`)).status, 400);
      assert.equal(
        (await http(`${url}/captions`, "GET", null, false)).status,
        401,
      );
      assert.equal(
        (
          await http(
            `/api/narration-media/${state.job.audioAssetId}`,
            "GET",
            null,
            false,
          )
        ).status,
        401,
      );
      assert.equal(
        (await http(`/api/narration-media/${new ObjectId()}`)).status,
        404,
      );
      console.log(
        "PASS: authenticated HTTP status/replay, revision/origin rejection, private SRT/VTT downloads, and protected audio access. No live R2 requests.",
      );
    }
    const retry = await content({
      ...form.config,
      voice: "monika",
      language: "hi",
    });
    await server.enqueueNarration(userId, retry.id, retry.body);
    const before = generated;
    await processNarrationStep({
      ...mock,
      align: () => {
        throw new Error("Injected alignment failure");
      },
    });
    state = await server.getNarrationState(userId, retry.id);
    assert.equal(state.job.status, "failed");
    assert.equal(state.job.audioAssetId, null);
    await assert.rejects(
      server.enqueueNarration(userId, retry.id, {
        ...retry.body,
        action: "retry",
      }),
      /cooldown/,
    );
    await db
      .collection("generation_jobs")
      .updateOne({ _id: state.job.id }, { $set: { retryAt: new Date(0) } });
    await server.enqueueNarration(userId, retry.id, {
      ...retry.body,
      action: "retry",
    });
    await processNarrationStep(mock);
    state = await server.getNarrationState(userId, retry.id);
    assert.equal(state.job.status, "completed");
    assert.equal(generated, before + 1, "Retry must reuse persisted speech");
    assert.equal(state.job.voice, "monika");
    assert.ok(state.job.timing.words.some((w) => w.text === "नमस्ते"));
    const stale = await content();
    await server.enqueueNarration(userId, stale.id, stale.body);
    await processNarrationStep({
      ...mock,
      generate: async (w) => {
        const result = await mock.generate(w);
        await db
          .collection("content_items")
          .updateOne(
            { _id: new ObjectId(stale.id) },
            { $set: { revision: 2 } },
          );
        return result;
      },
    });
    assert.equal(
      (
        await db
          .collection("generation_jobs")
          .findOne({ contentItemId: new ObjectId(stale.id), userId })
      ).status,
      "cancelled",
    );
    const late = await content();
    await server.enqueueNarration(userId, late.id, late.body);
    await processNarrationStep({
      ...mock,
      complete: async (w, timing) => {
        await db
          .collection("content_items")
          .updateOne({ _id: new ObjectId(late.id) }, { $set: { revision: 2 } });
        return base.complete(w, timing);
      },
    });
    const lateJob = await db
      .collection("generation_jobs")
      .findOne({ contentItemId: new ObjectId(late.id), userId });
    assert.equal(lateJob.status, "cancelled");
    assert.ok(
      lateJob.sourceAssetId,
      "Audio checkpoint survives a later stale commit",
    );
    assert.equal(lateJob.timing, null);
    const changed = await content();
    await server.enqueueNarration(userId, changed.id, changed.body);
    const lease = await base.claim();
    await server.updateContentItem(userId, changed.id, {
      revision: 1,
      mutationId: randomUUID(),
      form: {
        ...form,
        brief: { ...form.brief, title: "Changed synthetic title" },
      },
    });
    assert.equal(await base.current(lease), false);
    assert.equal(
      (await db.collection("generation_jobs").findOne({ _id: lease.jobId }))
        .status,
      "cancelled",
    );
    const interrupted = await content();
    await server.enqueueNarration(userId, interrupted.id, interrupted.body);
    const interruptedWork = await base.claim();
    await db
      .collection("generation_jobs")
      .updateOne(
        { _id: interruptedWork.jobId },
        { $set: { leaseUntil: new Date(0) } },
      );
    assert.equal(await base.claim(), null);
    state = await server.getNarrationState(userId, interrupted.id);
    assert.equal(state.job.status, "failed");
    assert.equal(state.job.canRetry, true);
    await server.enqueueNarration(userId, interrupted.id, {
      ...interrupted.body,
      action: "retry",
    });
    await processNarrationStep(mock);
    assert.equal(
      (await server.getNarrationState(userId, interrupted.id)).job.status,
      "completed",
    );
    const capped = await content();
    await server.enqueueNarration(userId, capped.id, capped.body);
    const budgetKey = `narration_budget:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    await db
      .collection("app_settings")
      .updateOne({ key: budgetKey }, { $set: { used: 6 } }, { upsert: true });
    await processNarrationStep(mock);
    state = await server.getNarrationState(userId, capped.id);
    assert.equal(state.job.status, "failed");
    assert.match(state.job.error, /hourly narration/);
    await db
      .collection("generation_jobs")
      .updateOne(
        { _id: state.job.id },
        { $set: { attempts: 3, retryAt: new Date(0) } },
      );
    await assert.rejects(
      server.enqueueNarration(userId, capped.id, {
        ...capped.body,
        action: "retry",
      }),
      /retry limit/,
    );
    const image = await content({
      format: "image",
      duration: null,
      voice: null,
      language: "en",
      visualStyle: "infographic",
    });
    await assert.rejects(
      server.getNarrationState(userId, image.id),
      /Reels only/,
    );
    console.log(
      "PASS: real MongoDB jobs and transaction fences with mock R2 SDK transport, duplicate starts, ownership, paused gates, checkpoint retry reuse, approved voices, Hindi captions, stale edits, interrupted leases, cooldowns, and hourly admission limit. No provider calls.",
    );
  }
} finally {
  if (db) {
    for (const asset of await db
      .collection("media_assets")
      .find({ userId, variant: "narration" })
      .toArray())
      await server.discardNarration(asset._id.toString(), userId, storage);
    for (const name of ["generation_jobs", "content_items"])
      await db.collection(name).deleteMany({ userId });
    await db
      .collection("app_settings")
      .deleteMany({ key: { $regex: `^narration_budget:${userId}:` } });
    if (process.argv.includes("--http")) {
      const ids = ObjectId.isValid(userId)
        ? [userId, new ObjectId(userId)]
        : [userId];
      for (const name of ["account", "session"])
        await db.collection(name).deleteMany({ userId: { $in: ids } });
      await db.collection("user").deleteMany({ email });
      await db
        .collection("rateLimit")
        .deleteMany({ key: { $regex: testIp.replaceAll(".", "\\.") } });
    }
  }
  assert.equal(objects.size, 0, "Fixture objects must be cleaned up");
  if (server && db) await (await server.getMongoClient()).close();
  await rm(workspace, { recursive: true, force: true });
}
