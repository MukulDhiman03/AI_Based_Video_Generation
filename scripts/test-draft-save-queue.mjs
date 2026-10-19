import assert from "node:assert/strict";
import { drainDraftSaveQueue } from "../src/lib/draft-save-queue.ts";

function fixture() {
  const lock = { current: false };
  const requests = [];
  const state = {
    text: "First edit",
    revision: 0,
    active: true,
    blocked: false,
  };
  const run = () =>
    drainDraftSaveQueue(
      lock,
      async () => {
        const snapshot = { text: state.text, revision: state.revision };
        const response = Promise.withResolvers();
        requests.push({ ...snapshot, response });
        const succeeded = await response.promise;
        if (!succeeded) return false; // Errors/conflicts require a manual retry.
        state.revision++;
        return snapshot.text !== state.text;
      },
      () => state.active && !state.blocked,
    );
  return { lock, requests, state, run };
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// The second debounce expires before the first network response. No state
// change, keystroke, or later debounce is available to restart the queue.
const pending = fixture();
const saving = pending.run();
pending.state.text = "Second edit";
await pending.run();
assert.equal(
  pending.requests.length,
  1,
  "An expired debounce must not start a concurrent write.",
);
pending.requests[0].response.resolve(true);
await nextTurn();
assert.equal(
  pending.requests.length,
  2,
  "Finishing the first save must send pending edits automatically.",
);
assert.equal(pending.requests[1].text, "Second edit");
assert.equal(
  pending.requests[1].revision,
  1,
  "The next save must use the acknowledged revision.",
);
assert.ok(pending.lock.current, "Keep the lock across follow-up writes.");
pending.state.text = "Third edit";
pending.state.text = "Latest edit";
await pending.run();
pending.requests[1].response.resolve(true);
await nextTurn();
assert.equal(
  pending.requests[2].text,
  "Latest edit",
  "Coalesce pending edits to their latest snapshot.",
);
assert.equal(pending.requests[2].revision, 2);
pending.requests[2].response.resolve(true);
await saving;
assert.equal(
  pending.requests.length,
  3,
  "Do not write again when the draft is clean.",
);
assert.equal(pending.lock.current, false);

for (const outcome of ["error", "conflict", "unmount"]) {
  const test = fixture();
  const running = test.run();
  test.state.text = "Still pending";
  await test.run();
  if (outcome === "conflict") test.state.blocked = true;
  if (outcome === "unmount") test.state.active = false;
  test.requests[0].response.resolve(outcome !== "error");
  await running;
  assert.equal(
    test.requests.length,
    1,
    `${outcome} must stop automatic draining.`,
  );
  assert.equal(test.lock.current, false, `${outcome} must release the lock.`);
  if (outcome === "error") {
    const retry = test.run();
    assert.equal(
      test.requests.length,
      2,
      "Manual retry must still work after an error.",
    );
    test.requests[1].response.resolve(true);
    await retry;
  }
}
const lock = { current: false };
await assert.rejects(
  drainDraftSaveQueue(
    lock,
    async () => {
      throw new Error("Unexpected failure");
    },
    () => true,
  ),
  /Unexpected failure/,
);
assert.equal(lock.current, false);
console.log(
  "PASS: autosave drains newer edits after an expired debounce, serializes revisions, and stops on errors/conflicts/unmount.",
);
