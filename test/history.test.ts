import { test } from "node:test";
import assert from "node:assert/strict";
import { entryText, formatHistory, searchBranch } from "../src/history.ts";

const branch = [
  { id: "e1", type: "message", message: { role: "user", content: "Fix the flaky limiter test" } },
  {
    id: "e2",
    type: "message",
    message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "bun test test/limiter.test.ts" } }] },
  },
  { id: "e3", type: "message", message: { role: "toolResult", content: [{ type: "text", text: "Error: ETIMEDOUT waiting for the server on port 4040" }] } },
  { id: "e4", type: "compaction", summary: "The limiter test was flaky because of a port clash." },
  { id: "e5", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Changed the port to 4041." }] } },
  { type: "custom", customType: "pify-note", data: {} },
];

test("entryText reads user/assistant text, tool-call names and arguments, tool results and compaction summaries", () => {
  assert.equal(entryText(branch[0])!.role, "user");
  assert.match(entryText(branch[1])!.text, /bash\(.*limiter\.test\.ts/);
  assert.equal(entryText(branch[2])!.role, "toolResult");
  assert.equal(entryText(branch[3])!.role, "compaction");
  assert.equal(entryText(branch[5]), null, "an entry with no text is skipped");
  assert.equal(entryText("junk"), null);
});

test("searchBranch finds the tool result an error string lived in, ranks by overlap then recency, and keeps entry ids", () => {
  const hits = searchBranch(branch, "ETIMEDOUT port");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]!.id, "e3", "the tool result with both terms ranks first");
  assert.equal(hits[0]!.index, 2);
  assert.match(hits[0]!.snippet, /ETIMEDOUT/);
  const ports = searchBranch(branch, "port");
  // Same overlap: the newer entry comes first.
  assert.equal(ports[0]!.id, "e5");
  assert.deepEqual(searchBranch(branch, "").length, 0);
  assert.equal(searchBranch(branch, "port", { limit: 1 }).length, 1);
});

test("formatHistory names the entry and stays bounded", () => {
  const hits = searchBranch(branch, "limiter");
  const text = formatHistory("limiter", hits, branch.length);
  assert.match(text, /of this session's 6 entries match "limiter"/);
  assert.match(text, /\[#0 · e1 · user\]/);
  const empty = formatHistory("zzz", [], branch.length);
  assert.match(empty, /Nothing in this session's 6 entries/);
  const tiny = formatHistory("limiter", hits, branch.length, 120);
  assert.match(tiny, /more omitted/);
});
