import { test } from "node:test";
import assert from "node:assert/strict";
import { docFromEntry, readSessionDocs, listSessionFiles } from "../src/sessions.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("keeps user and assistant text; skips other roles", () => {
  assert.equal(docFromEntry({ message: { role: "user", content: "fix the bug" } }, "s", "/p")?.text, "fix the bug");
  const asst = docFromEntry(
    { message: { role: "assistant", content: [{ type: "text", text: "done" }, { type: "thinking", thinking: "hmm" }] } },
    "s",
    "/p",
  );
  assert.equal(asst?.text, "done", "thinking blocks are excluded");
  assert.equal(docFromEntry({ message: { role: "toolResult", content: "big output" } }, "s", "/p"), null);
  assert.equal(docFromEntry({ message: { role: "user", content: "   " } }, "s", "/p"), null, "empty text dropped");
});

test("parses a timestamp from common fields, defaults to 0", () => {
  assert.equal(docFromEntry({ timestamp: 1234, message: { role: "user", content: "x" } }, "s", "/p")?.ts, 1234);
  assert.equal(
    docFromEntry({ message: { role: "user", content: "x", timestamp: "2026-09-14T00:00:00Z" } }, "s", "/p")?.ts,
    Date.parse("2026-09-14T00:00:00Z"),
  );
  assert.equal(docFromEntry({ message: { role: "user", content: "x" } }, "s", "/p")?.ts, 0);
});

test("readSessionDocs parses JSONL, tolerates a corrupt line", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-sess-"));
  try {
    const f = join(dir, "abc.jsonl");
    writeFileSync(
      f,
      [
        JSON.stringify({ message: { role: "user", content: "hello there" } }),
        "{ not json",
        JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "hi back" }] } }),
      ].join("\n"),
    );
    const docs = readSessionDocs(f);
    assert.equal(docs.length, 2);
    assert.equal(docs[0]!.session, "abc");
    assert.equal(docs[1]!.text, "hi back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listSessionFiles finds .jsonl recursively", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-list-"));
  try {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "a.jsonl"), "{}");
    writeFileSync(join(dir, "sub", "b.jsonl"), "{}");
    writeFileSync(join(dir, "c.txt"), "no");
    const files = listSessionFiles(dir).map((f) => f.path).sort();
    assert.equal(files.length, 2);
    assert.ok(files.some((p) => p.endsWith("a.jsonl")));
    assert.ok(files.some((p) => p.endsWith("b.jsonl")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session nobody named is labelled after its first prompt, never the raw log id", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "recall-label-"));
  try {
    const file = join(dir, "2026-09-26T10-00-00_0000-uuid.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "custom", customType: "pify-memory", message: { role: "user", content: "injected plumbing" } }),
        JSON.stringify({ type: "message", message: { role: "user", content: "Fix the **flaky** limiter test", timestamp: 1 } }),
        JSON.stringify({ type: "message", message: { role: "assistant", content: "On it.", timestamp: 2 } }),
      ].join("\n"),
    );
    const docs = readSessionDocs(file);
    assert.ok(docs.length >= 2);
    assert.equal(docs[0]!.title, "Fix the flaky limiter test", "the first typed prompt, cleaned, not the injected message");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
