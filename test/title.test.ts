import { test } from "node:test";
import assert from "node:assert/strict";
import { firstUserText, sessionTitle } from "../src/title.ts";
import { docFromEntry, sessionInfoName, readSessionDocs } from "../src/sessions.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sessionTitle uses the first meaningful line, cleaned", () => {
  assert.equal(sessionTitle("add a retry to the uploader"), "add a retry to the uploader");
  assert.equal(sessionTitle("## Fix the parser\nmore detail"), "Fix the parser");
  assert.equal(sessionTitle("  - `refactor` the **client**  "), "refactor the client");
  assert.equal(sessionTitle("why is this failing?"), "why is this failing");
});

test("sessionTitle skips bare slash commands and empty prompts", () => {
  assert.equal(sessionTitle("/resume"), "");
  assert.equal(sessionTitle("/compact"), "");
  assert.equal(sessionTitle(""), "");
  assert.equal(sessionTitle("   \n  "), "");
  // a slash command WITH an argument is still a topic
  assert.ok(sessionTitle("/fix the flaky spawn test").length > 0);
});

test("sessionTitle cuts at a word boundary and marks the cut", () => {
  const long = "implement the incremental index sync so a large session directory does not rebuild every time";
  const out = sessionTitle(long, 40);
  assert.ok(out.length <= 41, `${out.length} <= 41 (40 + ellipsis)`);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("  "));
  // no mid-word cut
  assert.ok(long.startsWith(out.slice(0, -1)));
});

test("firstUserText takes the first typed message, skipping injected ones", () => {
  const entries = [
    { customType: "memory-context", message: { role: "user", content: "INJECTED CONTEXT" } },
    { message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    { message: { role: "user", content: [{ type: "text", text: "real question" }] } },
    { message: { role: "user", content: "later" } },
  ];
  assert.equal(firstUserText(entries), "real question");
  assert.equal(firstUserText([]), "");
  assert.equal(firstUserText([{ message: { role: "assistant", content: "x" } }]), "");
});

test("sessionInfoName reads pi's session_info entry", () => {
  assert.equal(sessionInfoName({ type: "session_info", name: "Fix the parser" }), "Fix the parser");
  assert.equal(sessionInfoName({ type: "session_info", name: "   " }), undefined);
  assert.equal(sessionInfoName({ type: "message", name: "nope" }), undefined);
  assert.equal(sessionInfoName(null), undefined);
});

test("a session's docs carry its display name, even when named after the messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "pify-recall-"));
  const file = join(dir, "abc123.jsonl");
  try {
    writeFileSync(
      file,
      [
        JSON.stringify({ message: { role: "user", content: "add a retry to the uploader" } }),
        JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
        // pi writes the name after the fact; it still labels the whole session
        JSON.stringify({ type: "session_info", name: "add a retry to the uploader" }),
      ].join("\n"),
    );
    const docs = readSessionDocs(file);
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.title === "add a retry to the uploader"), JSON.stringify(docs));
    assert.equal(docs[0]!.session, "abc123", "the raw id is still the fallback");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unnamed session leaves docs untitled (the id is used)", () => {
  const doc = docFromEntry({ message: { role: "user", content: "hello" } }, "sess-1", "/p.jsonl");
  assert.equal(doc?.title, undefined);
  assert.equal(doc?.session, "sess-1");
});
