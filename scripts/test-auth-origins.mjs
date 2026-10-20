import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";
const configured = new URL(process.env.BETTER_AUTH_URL);
assert.ok(
  ["127.0.0.1", "localhost"].includes(configured.hostname),
  "Local-only auth regression check",
);
const { uri, databaseName } = getMongoConfig(),
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    timeoutMS: 30000,
  });
const fixtures = [],
  ips = [];
let db;
try {
  await client.connect();
  db = client.db(databaseName);
  for (const hostname of ["127.0.0.1", "localhost"]) {
    const url = new URL(configured.origin);
    url.hostname = hostname;
    const origin = url.origin;
    const email = `auth-origin-${randomUUID()}@example.invalid`,
      password = `Qa-${randomUUID()}-${randomUUID()}`,
      ip = `198.18.105.${Math.floor(Math.random() * 200) + 1}`;
    fixtures.push({ email });
    ips.push(ip);
    const request = (pathname, method = "GET", body, cookie, source = origin) =>
      fetch(origin + pathname, {
        method,
        redirect: "manual",
        headers: {
          origin: source,
          "content-type": "application/json",
          "x-forwarded-for": ip,
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const credentials = { email, password };
    let response = await request("/api/auth/sign-up/email", "POST", {
      ...credentials,
      name: "Auth Origin QA",
    });
    assert.equal(
      response.status,
      200,
      `${hostname} signup: ${await response.clone().text()}`,
    );
    const user = (await response.json()).user;
    fixtures.at(-1).userId = user.id;
    let cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    response = await request("/api/auth/get-session", "GET", undefined, cookie);
    assert.equal((await response.json()).user.id, user.id);
    response = await request("/api/auth/sign-out", "POST", {}, cookie);
    assert.equal(response.status, 200);
    response = await request("/api/auth/sign-in/email", "POST", credentials);
    assert.equal(
      response.status,
      200,
      `${hostname} signin: ${await response.clone().text()}`,
    );
    cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    response = await request(
      "/api/content",
      "POST",
      {
        mode: "manual",
        creationId: randomUUID(),
        form: {
          brief: {
            title: "Origin regression fixture",
            hook: "Synthetic test",
            summary: "A synthetic draft used to verify local origin handling.",
          },
          config: {
            format: "image",
            duration: null,
            voice: null,
            language: "en",
            visualStyle: "infographic",
          },
        },
      },
      cookie,
    );
    assert.ok(
      [200, 201].includes(response.status),
      `${hostname} draft save: ${await response.clone().text()}`,
    );
    response = await request(
      "/api/auth/sign-in/email",
      "POST",
      credentials,
      undefined,
      "https://untrusted.example",
    );
    assert.equal(response.status, 403);
    response = await request(
      "/api/content",
      "POST",
      {},
      cookie,
      "https://untrusted.example",
    );
    assert.equal(response.status, 403);
    response = await request(
      "/api/auth/sign-out",
      "POST",
      {},
      cookie,
      "https://untrusted.example",
    );
    assert.equal(response.status, 403);
    await request("/api/auth/sign-out", "POST", {}, cookie);
    console.log(
      `PASS: ${hostname} signup, sign-in, session, authenticated draft save, and sign-out; foreign-origin authentication and writes still return 403.`,
    );
  }
} finally {
  if (db) {
    for (const fixture of fixtures) {
      const user = await db
        .collection("user")
        .findOne({ email: fixture.email });
      const id = fixture.userId ?? user?._id?.toString();
      if (id) {
        const ids = ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id];
        for (const name of ["account", "session"])
          await db.collection(name).deleteMany({ userId: { $in: ids } });
        await db.collection("content_items").deleteMany({ userId: id });
      }
      await db.collection("user").deleteMany({ email: fixture.email });
    }
    for (const ip of ips)
      await db
        .collection("rateLimit")
        .deleteMany({ key: { $regex: ip.replaceAll(".", "\\.") } });
  }
  await client.close();
}
