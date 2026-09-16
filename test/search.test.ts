import { test } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/search.ts";
import { syncIndex, type FileRef } from "../src/index-core.ts";
import { emptyIndex, type Doc } from "../src/types.ts";

const doc = (session: string, text: string, ts = 0): Doc => ({ session, path: `/s/${session}.jsonl`, ts, role: "user", text });

function indexOf(docs: Doc[]) {
  const idx = emptyIndex();
  const files: FileRef[] = docs.map((d, i) => ({ path: d.path, size: i, mtimeMs: i + 1 }));
  const byPath: Record<string, Doc[]> = {};
  for (const d of docs) (byPath[d.path] ??= []).push(d);
  syncIndex(idx, files, (p) => byPath[p] ?? []);
  return idx;
}

test("ranks docs matching more query terms first", () => {
  const idx = indexOf([
    doc("a", "the auth token refresh flow"),
    doc("b", "an unrelated note about auth only"),
  ]);
  const hits = search(idx, "auth token refresh");
  assert.equal(hits[0]!.session, "a", "3 terms beats 1");
  assert.equal(hits[0]!.matched, 3);
});

test("recency breaks ties between equally-matching docs", () => {
  const idx = indexOf([doc("older", "deploy script", 1000), doc("newer", "deploy script", 5000)]);
  const hits = search(idx, "deploy script");
  assert.equal(hits[0]!.session, "newer");
});

test("substring fallback finds a match the tokenizer can't", () => {
  const idx = indexOf([doc("a", "error code E4011 in the parser")]);
  // "E4011" tokenizes to "e4011"; but a punctuation-only query has no terms →
  // fallback. Use a 1-char query to force the fallback path.
  const hits = search(idx, "E4");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.session, "a");
});

test("excludePath skips the live session", () => {
  const idx = indexOf([doc("live", "shared term here"), doc("past", "shared term here", 1)]);
  const hits = search(idx, "shared term", { excludePath: "/s/live.jsonl" });
  assert.ok(hits.every((h) => h.session !== "live"));
  assert.equal(hits[0]!.session, "past");
});

test("limit bounds the number of hits", () => {
  const idx = indexOf(Array.from({ length: 20 }, (_, i) => doc(`s${i}`, "common term", i)));
  assert.equal(search(idx, "common", { limit: 5 }).length, 5);
});

test("the snippet frames the matched term", () => {
  const long = `${"prefix ".repeat(40)}NEEDLE ${"suffix ".repeat(40)}`;
  const idx = indexOf([doc("a", long)]);
  const [hit] = search(idx, "needle", { snippetChars: 60 });
  assert.ok(hit!.snippet.toLowerCase().includes("needle"), hit!.snippet);
  assert.ok(hit!.snippet.length < long.length);
});

test("no match returns nothing (not a throw)", () => {
  const idx = indexOf([doc("a", "hello world")]);
  assert.deepEqual(search(idx, "nonexistentterm"), []);
});

test("REGRESSION: searching for a word that is also an Object.prototype member", () => {
  const idx = emptyIndex();
  syncIndex(idx, [{ path: "/s/a.jsonl", size: 1, mtimeMs: 1 }, { path: "/s/b.jsonl", size: 1, mtimeMs: 2 }], (p) =>
    p === "/s/a.jsonl"
      ? [{ session: "a", path: p, ts: 1, role: "user", text: "why does the constructor run twice" }]
      : [{ session: "b", path: p, ts: 2, role: "user", text: "unrelated" }],
  );
  const hits = search(idx, "constructor");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.session, "a");
  // A prototype member no session ever said is simply not found — not a throw.
  assert.deepEqual(search(idx, "valueOf"), []);
});
