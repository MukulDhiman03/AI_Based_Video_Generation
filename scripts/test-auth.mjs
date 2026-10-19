import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";
import fs from "node:fs/promises";

// Integration checks against a running LOCAL app. Only synthetic, uniquely
// identified fixtures in vidsutra_ai are created and cleaned up.
const origin = process.env.BETTER_AUTH_URL;
assert.ok(
  origin && new URL(origin).hostname === "127.0.0.1",
  "Run against the local app only.",
);
const { uri, databaseName } = getMongoConfig();
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
const nonce = randomBytes(6).toString("hex");
const email = `auth-qa-${nonce}@example.invalid`;
const password = `Qa-only-${randomBytes(20).toString("hex")}`;
const hashes = [];
const emails = [email];
const ips = [];
let db;
const dashboardFixtures = [];

async function dashboardFixture(collection, document) {
  const result = await db.collection(collection).insertOne(document);
  dashboardFixtures.push({ collection, id: result.insertedId });
}

function appRequest(path, cookie) {
  return fetch(origin + path, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
}

async function saveLayoutSnapshot(html, name) {
  if (!process.env.DASHBOARD_QA_SNAPSHOTS) return;
  const start = html.indexOf('<div class="dash-workspace">');
  assert.ok(start >= 0, "Dashboard markup must be present.");
  const tail = html.slice(start);
  let depth = 0;
  let end = 0;
  for (const match of tail.matchAll(/<\/?div(?:\s[^>]*)?>/g)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = match.index + match[0].length;
      break;
    }
  }
  assert.ok(end > 0);
  const css = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]
    .map((match) => match[0])
    .join("");
  // Only rendered fictional UI and public styles are exported. No scripts,
  // session cookies, RSC payloads, database records, or credentials are retained.
  const fragment = tail.slice(0, end);
  assert.ok(!fragment.includes("<script"));
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${origin}/"><title>Dashboard layout QA</title>${css}</head><body>${fragment}<div style="position:fixed;bottom:4px;left:4px;background:#181824;color:#aaa;font:9px sans-serif;padding:4px;z-index:99">Layout QA · synthetic account removed after testing</div></body></html>`;
  await fs.mkdir("/private/tmp/vidsutra-dashboard-qa", { recursive: true });
  await fs.writeFile(`/private/tmp/vidsutra-dashboard-qa/${name}.html`, page);
}

async function invite(status = "pending", expired = false, recipient = email) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  hashes.push(tokenHash);
  await db.collection("beta_invitations").insertOne({
    email: recipient,
    tokenHash,
    status,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000 * 10)),
  });
  return token;
}

async function request(path, body, extra = {}) {
  const ip =
    extra.ip || `198.18.${parseInt(nonce.slice(0, 2), 16)}.${ips.length + 1}`;
  ips.push(ip);
  return fetch(origin + "/api/auth" + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(extra.token ? { "x-vidsutra-invite": extra.token } : {}),
      ...(extra.cookie ? { cookie: extra.cookie } : {}),
      ...extra.headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function cookieFrom(response) {
  const cookies = response.headers.getSetCookie();
  const sessionCookie = cookies.find((cookie) =>
    cookie.split("=")[0].includes("session_token"),
  );
  assert.ok(
    sessionCookie && /httponly/i.test(sessionCookie),
    "Session cookie must be HttpOnly.",
  );
  assert.ok(
    /samesite=lax/i.test(sessionCookie),
    "Session cookie must use SameSite=Lax.",
  );
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

try {
  await client.connect();
  db = client.db(databaseName);
  const root = await fetch(origin, { redirect: "manual" });
  assert.equal(root.status, 307, "Root should redirect.");
  assert.equal(root.headers.get("location"), "/sign-in");
  const anonymousHome = await appRequest("/home");
  assert.equal(anonymousHome.status, 307, "Dashboard must require sign-in.");
  assert.equal(anonymousHome.headers.get("location"), "/sign-in");
  assert.equal((await appRequest("/api/dashboard")).status, 401);
  for (const path of [
    "/create",
    "/library",
    "/ideas",
    "/settings",
    "/api/plans",
  ]) {
    assert.equal(
      (await fetch(origin + path)).status,
      404,
      "Old page/API must be retired.",
    );
  }
  const signup = { email, password, name: "Auth QA" };
  for (const blankHeader of [false, true]) {
    const openEmail = `open-${blankHeader ? "blank" : "missing"}-${email}`;
    emails.push(openEmail);
    const response = await request(
      "/sign-up/email",
      { ...signup, email: openEmail },
      blankHeader ? { headers: { "x-vidsutra-invite": "" } } : {},
    );
    assert.equal(
      response.status,
      200,
      "Signup without an invitation must succeed.",
    );
    const openCookie = cookieFrom(response);
    assert.equal(
      (
        await (
          await request("/get-session", null, { cookie: openCookie })
        ).json()
      ).user.email,
      openEmail,
    );
    const openUser = await db.collection("user").findOne({ email: openEmail });
    assert.ok(openUser, "Signup without an invitation must persist the user.");
    const openAccount = await db
      .collection("account")
      .findOne({ userId: { $in: [openUser._id, openUser._id.toString()] } });
    assert.ok(
      openAccount?.password && openAccount.password !== password,
      "Open signup must hash the password.",
    );
    assert.equal(
      (await request("/sign-out", {}, { cookie: openCookie })).status,
      200,
    );
    const login = await request("/sign-in/email", {
      email: openEmail,
      password,
    });
    assert.equal(
      login.status,
      200,
      "User registered without an invitation must be able to sign in.",
    );
    assert.equal(
      (await request("/sign-out", {}, { cookie: cookieFrom(login) })).status,
      200,
    );
  }
  assert.equal(
    (await request("/sign-up/email", { ...signup, password: "short" })).status,
    400,
    "Open signup must still validate passwords.",
  );
  assert.equal(
    (
      await request("/sign-up/email", signup, {
        token: await invite("pending", true),
      })
    ).status,
    403,
    "Expired invite must fail.",
  );
  assert.equal(
    (
      await request("/sign-up/email", signup, {
        token: await invite("revoked"),
      })
    ).status,
    403,
    "Revoked invite must fail.",
  );
  const token = await invite();
  assert.equal(
    (
      await request(
        "/sign-up/email",
        { ...signup, email: `other-${email}` },
        { token },
      )
    ).status,
    403,
    "Wrong invited email must fail.",
  );
  assert.equal(
    (
      await request(
        "/sign-up/email",
        { ...signup, password: "short" },
        { token },
      )
    ).status,
    400,
    "Short password must fail on server.",
  );
  assert.equal(
    await db.collection("user").countDocuments({ email }),
    0,
    "Rejected signup must not create users.",
  );

  const registered = await request("/sign-up/email", signup, { token });
  assert.equal(registered.status, 200, "Invited signup should succeed.");
  const cookie = cookieFrom(registered);
  const user = await db.collection("user").findOne({ email });
  assert.ok(user, "Registered user must be persisted.");
  const ids = [user._id, user._id.toString()];
  for (const path of ["/", "/sign-in", "/sign-up"]) {
    const response = await appRequest(path, cookie);
    assert.equal(
      response.status,
      307,
      "Signed-in users should enter their studio.",
    );
    assert.equal(response.headers.get("location"), "/home");
  }
  const home = await appRequest("/home", cookie);
  assert.equal(home.status, 200, "Signed-in dashboard should render.");
  const emptyHomeHtml = await home.text();
  assert.ok(emptyHomeHtml.includes("Your next idea, brought to life."));
  await saveLayoutSnapshot(emptyHomeHtml, "empty");
  const emptyDashboard = await appRequest("/api/dashboard", cookie);
  assert.equal(emptyDashboard.status, 200);
  assert.equal(emptyDashboard.headers.get("cache-control"), "no-store");
  const emptyData = await emptyDashboard.json();
  assert.equal(emptyData.totalContent, 0);
  assert.equal(emptyData.allowance, null, "A quota must not be fabricated.");
  assert.equal(emptyData.connection.status, "disconnected");

  const foreignId = new ObjectId();
  const privateMarker = `PRIVATE-DASHBOARD-${nonce}`;
  await dashboardFixture("content_items", {
    userId: user._id.toString(),
    title: "QA owned content",
    format: "image",
    language: "hi",
    status: "completed",
    updatedAt: new Date(),
    internalNote: privateMarker,
  });
  await dashboardFixture("content_items", {
    userId: foreignId,
    title: "FOREIGN-CONTENT-" + nonce,
    format: "reel",
    status: "completed",
    updatedAt: new Date(),
  });
  await dashboardFixture("generation_jobs", {
    userId: user._id,
    title: "QA owned job",
    status: "running",
    stage: "animation",
    createdAt: new Date(),
    errorDetails: privateMarker,
  });
  await dashboardFixture("generation_jobs", {
    userId: foreignId,
    title: "FOREIGN-JOB-" + nonce,
    status: "running",
    createdAt: new Date(),
  });
  await dashboardFixture("publications", {
    userId: user._id.toString(),
    title: "QA owned scheduled post",
    status: "scheduled",
    scheduledFor: new Date(Date.now() + 3600000),
  });
  await dashboardFixture("publications", {
    userId: foreignId,
    title: "FOREIGN-PUBLICATION-" + nonce,
    status: "scheduled",
    scheduledFor: new Date(),
  });
  await dashboardFixture("social_accounts", {
    userId: user._id.toString(),
    provider: "instagram",
    username: "qa_owned",
    status: "connected",
    accessToken: privateMarker,
  });
  await dashboardFixture("social_accounts", {
    userId: foreignId,
    provider: "instagram",
    username: "FOREIGN-ACCOUNT-" + nonce,
    status: "connected",
  });
  await dashboardFixture("app_settings", {
    key: `generation_allowance:${user._id}`,
    limit: 5,
    used: 2,
  });
  await dashboardFixture("app_settings", {
    key: `generation_allowance:${foreignId}`,
    limit: 9999,
    used: 0,
  });
  const dashboardResponse = await appRequest(
    "/api/dashboard?userId=" + foreignId,
    cookie,
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(
    dashboard.totalContent,
    1,
    "Dashboard must only count the session owner’s content.",
  );
  assert.equal(dashboard.recentContent.length, 1);
  assert.equal(dashboard.featured.title, "QA owned content");
  assert.equal(dashboard.featured.language, "Hindi");
  assert.equal(dashboard.activeJob.title, "QA owned job");
  assert.equal(dashboard.activeJob.stage, "Animation");
  assert.equal(dashboard.upcoming.length, 1);
  assert.equal(dashboard.upcoming[0].title, "QA owned scheduled post");
  assert.equal(dashboard.connection.username, "qa_owned");
  assert.equal(dashboard.allowance.limit, 5);
  assert.equal(dashboard.allowance.used, 2);
  const serialized = JSON.stringify(dashboard);
  assert.ok(
    !serialized.includes("FOREIGN-") && !serialized.includes(privateMarker),
    "Other users’ records and private fields must not leak.",
  );
  const populatedHtml = await (await appRequest("/home", cookie)).text();
  assert.ok(
    populatedHtml.includes("Educational graphic") &&
      !populatedHtml.includes("Two voices. Your point of view."),
    "Image posts must not display voice controls.",
  );
  assert.ok(
    !populatedHtml.includes(privateMarker) &&
      !populatedHtml.includes("FOREIGN-"),
  );
  await saveLayoutSnapshot(populatedHtml, "populated");
  const account = await db
    .collection("account")
    .findOne({ userId: { $in: ids } });
  assert.ok(
    account?.password && account.password !== password,
    "Stored password must be a hash.",
  );
  assert.equal(
    (
      await db.collection("beta_invitations").findOne({
        tokenHash: createHash("sha256").update(token).digest("hex"),
      })
    ).status,
    "accepted",
  );
  assert.equal(
    (await request("/sign-up/email", signup, { token })).status,
    403,
    "Used invitation must fail.",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await request("/get-session", null, { cookie });
    assert.equal(
      (await session.json()).user.email,
      email,
      "Session must persist across independent requests.",
    );
  }
  assert.equal((await request("/sign-out", {}, { cookie })).status, 200);
  assert.equal(
    (await appRequest("/api/dashboard", cookie)).status,
    401,
    "Signed-out sessions cannot access dashboard data.",
  );
  assert.equal(
    await (await request("/get-session", null, { cookie })).json(),
    null,
    "Signed-out session must be invalid.",
  );
  assert.equal(
    (
      await request("/sign-in/email", {
        email,
        password: "incorrect-password-only",
      })
    ).status,
    401,
    "Wrong password must fail.",
  );
  const signedIn = await request("/sign-in/email", {
    email,
    password,
    rememberMe: false,
  });
  assert.equal(signedIn.status, 200, "Existing account should sign in.");
  const newCookie = cookieFrom(signedIn);
  const shortCookie = signedIn.headers
    .getSetCookie()
    .find((c) => c.split("=")[0].includes("session_token"));
  assert.ok(
    !/Max-Age=\d+/i.test(shortCookie),
    "Remember-me off should use a session cookie.",
  );
  assert.equal(
    (
      await request(
        "/sign-out",
        {},
        { cookie: newCookie, headers: { origin: "https://untrusted.example" } },
      )
    ).status,
    403,
    "Untrusted origin must fail.",
  );
  assert.equal(
    (await request("/sign-out", {}, { cookie: newCookie })).status,
    200,
  );

  const raceEmail = `concurrent-${email}`;
  emails.push(raceEmail);
  const raceToken = await invite("pending", false, raceEmail);
  const registrations = await Promise.all([
    request(
      "/sign-up/email",
      { ...signup, email: raceEmail },
      { token: raceToken },
    ),
    request(
      "/sign-up/email",
      { ...signup, email: raceEmail },
      { token: raceToken },
    ),
  ]);
  assert.equal(
    registrations.filter((response) => response.status === 200).length,
    1,
    "Concurrent invitation use must create only one account.",
  );
  assert.equal(
    await db.collection("user").countDocuments({ email: raceEmail }),
    1,
  );

  const rateIP = `198.19.${parseInt(nonce.slice(2, 4), 16)}.200`;
  let limited;
  for (let count = 0; count < 6; count++)
    limited = await request(
      "/sign-in/email",
      { email, password: "wrong-password-only" },
      { ip: rateIP },
    );
  assert.equal(limited.status, 429, "Repeated attempts must be rate limited.");

  console.log(
    "PASS: authentication, optional invitations, dashboard redirects/protection, empty states, account-scoped content/jobs/publications/connections/allowance, private-field exclusion, sign-out protection, rate limiting, and route reset.",
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Authentication integration checks failed.",
  );
  process.exitCode = 1;
} finally {
  if (db) {
    for (const fixture of dashboardFixtures) {
      await db.collection(fixture.collection).deleteOne({ _id: fixture.id });
    }
    const users = await db
      .collection("user")
      .find({ email: { $in: emails } })
      .toArray();
    const ids = users.flatMap((user) => [user._id, user._id.toString()]);
    await db.collection("session").deleteMany({ userId: { $in: ids } });
    await db.collection("account").deleteMany({ userId: { $in: ids } });
    await db.collection("user").deleteMany({ email: { $in: emails } });
    await db
      .collection("beta_invitations")
      .deleteMany({ tokenHash: { $in: hashes } });
    // These reserved benchmark-network addresses are generated by this run.
    if (ips.length)
      await db.collection("rateLimit").deleteMany({
        $or: [...new Set(ips)].map((ip) => ({
          key: { $regex: ip.replaceAll(".", "\\.") },
        })),
      });
  }
  await client.close();
}
