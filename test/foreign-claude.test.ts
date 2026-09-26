import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeDocFromEntry, claudeProjectDir, claudeProjectSlug, readClaudeDocs } from "../src/foreign-claude.ts";

test("the project slug is the path with separators and colons turned into dashes", () => {
  assert.equal(claudeProjectSlug("D:\\project\\pify-plugins"), "D--project-pify-plugins");
  assert.equal(claudeProjectSlug("/home/me/repo"), "-home-me-repo");
  assert.match(claudeProjectDir("/home/me/repo", "/home/me").replace(/\\/g, "/"), /\.claude\/projects\/-home-me-repo$/);
});

test("only user/assistant text is taken; tool blocks, summaries and unknown shapes are skipped", () => {
  const lines = [
    JSON.stringify({ type: "summary", summary: "irrelevant" }),
    JSON.stringify({ type: "user", timestamp: "2026-09-20T10:00:00.000Z", message: { role: "user", content: "Fix the flaky limiter test" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-09-20T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "Reading limiter.ts" }, { type: "tool_use", name: "Read", input: {} }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "file contents" }] } }),
    "not json",
  ].join("\n");
  const docs = readClaudeDocs("/h/.claude/projects/x/abc.jsonl", lines);
  assert.equal(docs.length, 2);
  assert.equal(docs[0]!.role, "user");
  assert.equal(docs[0]!.ts, Date.parse("2026-09-20T10:00:00.000Z"));
  assert.equal(docs[1]!.text, "Reading limiter.ts");
  assert.equal(docs[0]!.title, "claude · Fix the flaky limiter test");
  assert.equal(docs[0]!.session, "abc");
  assert.equal(claudeDocFromEntry({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use" }] } }, "s", "p"), null);
});
