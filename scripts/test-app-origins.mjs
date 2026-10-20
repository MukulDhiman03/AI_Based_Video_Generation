import assert from "node:assert/strict";
import { appOrigins, isAppOrigin } from "../src/lib/app-origins.ts";
assert.deepEqual(appOrigins("http://127.0.0.1:3005"), [
  "http://127.0.0.1:3005",
  "http://localhost:3005",
]);
assert.deepEqual(appOrigins("http://localhost:3005/path"), [
  "http://localhost:3005",
  "http://127.0.0.1:3005",
]);
assert.deepEqual(appOrigins("https://vidsutra.example"), [
  "https://vidsutra.example",
]);
assert.equal(
  isAppOrigin("http://localhost:3005", "http://127.0.0.1:3005"),
  true,
);
for (const origin of [
  null,
  "null",
  "https://localhost:3005",
  "http://localhost:3000",
  "http://localhost:3005/",
  "http://localhost.attacker.invalid:3005",
  "http://127.0.0.1.attacker.invalid:3005",
  "https://attacker.invalid",
])
  assert.equal(
    isAppOrigin(origin, "http://127.0.0.1:3005"),
    false,
    `${origin} must remain untrusted`,
  );
assert.equal(
  isAppOrigin("http://localhost:3005", "https://vidsutra.example"),
  false,
);
console.log(
  "PASS: localhost/127.0.0.1 aliases share only the configured protocol and port; production, foreign, opaque, and lookalike origins remain restricted.",
);
