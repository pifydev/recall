import { test } from "node:test";
import assert from "node:assert/strict";
import { isUserRun } from "../src/run-origin.ts";

test("a user prompt is a user run, on pi 1.2.0 and on older pi without messageType", () => {
  assert.equal(isUserRun({ type: "before_agent_start", messageType: "user", prompt: "hi" }), true);
  assert.equal(isUserRun({ type: "before_agent_start", prompt: "hi" }), true, "pre-1.2.0 shape");
  assert.equal(isUserRun({}), true);
  assert.equal(isUserRun(undefined), true);
});

test("a run started by a custom message is not", () => {
  assert.equal(isUserRun({ type: "before_agent_start", messageType: "custom", message: { customType: "x" } }), false);
  assert.equal(isUserRun({ messageType: "anything-else" }), false, "an unknown kind is not a person speaking");
});
