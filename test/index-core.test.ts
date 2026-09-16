import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIndex, docCount, type FileRef } from "../src/index-core.ts";
import { emptyIndex, type Doc } from "../src/types.ts";

const doc = (session: string, text: string, ts = 0, role = "user"): Doc => ({
  session,
  path: `/s/${session}.jsonl`,
  ts,
  role,
  text,
});

function reader(map: Record<string, Doc[]>): (path: string) => Doc[] {
  return (path) => map[path] ?? [];
}

test("first sync indexes all files and builds postings", () => {
  const idx = emptyIndex();
  const files: FileRef[] = [
    { path: "/s/a.jsonl", size: 10, mtimeMs: 1 },
    { path: "/s/b.jsonl", size: 10, mtimeMs: 2 },
  ];
  const changed = syncIndex(idx, files, reader({
    "/s/a.jsonl": [doc("a", "fix the auth bug")],
    "/s/b.jsonl": [doc("b", "write the migration")],
  }));
  assert.equal(changed, true);
  assert.equal(docCount(idx), 2);
  assert.ok(idx.postings["auth"], "term indexed");
  assert.ok(idx.postings["migration"]);
});

test("an unchanged file is not re-read on the next sync", () => {
  const idx = emptyIndex();
  const files: FileRef[] = [{ path: "/s/a.jsonl", size: 10, mtimeMs: 1 }];
  syncIndex(idx, files, reader({ "/s/a.jsonl": [doc("a", "hello")] }));
  let reads = 0;
  const changed = syncIndex(idx, files, (p) => {
    reads++;
    return [doc("a", "hello")];
  });
  assert.equal(changed, false);
  assert.equal(reads, 0, "unchanged file skipped");
});

test("a changed file drops its old docs and re-indexes", () => {
  const idx = emptyIndex();
  syncIndex(idx, [{ path: "/s/a.jsonl", size: 10, mtimeMs: 1 }], reader({ "/s/a.jsonl": [doc("a", "old content alpha")] }));
  assert.ok(idx.postings["alpha"]);
  // same path, new mtime/size → re-read
  syncIndex(idx, [{ path: "/s/a.jsonl", size: 20, mtimeMs: 2 }], reader({ "/s/a.jsonl": [doc("a", "new content beta")] }));
  assert.equal(docCount(idx), 1);
  assert.ok(!idx.postings["alpha"], "old term gone");
  assert.ok(idx.postings["beta"], "new term present");
});

test("a removed file's docs are pruned", () => {
  const idx = emptyIndex();
  syncIndex(idx, [
    { path: "/s/a.jsonl", size: 10, mtimeMs: 1 },
    { path: "/s/b.jsonl", size: 10, mtimeMs: 2 },
  ], reader({ "/s/a.jsonl": [doc("a", "keep me")], "/s/b.jsonl": [doc("b", "drop me")] }));
  // b disappears
  syncIndex(idx, [{ path: "/s/a.jsonl", size: 10, mtimeMs: 1 }], reader({ "/s/a.jsonl": [doc("a", "keep me")] }));
  assert.equal(docCount(idx), 1);
  assert.ok(idx.postings["keep"]);
  assert.ok(!idx.postings["drop"]);
});

test("maxDocs caps the corpus, keeping the newest files", () => {
  const idx = emptyIndex();
  const files: FileRef[] = [
    { path: "/s/old.jsonl", size: 1, mtimeMs: 1 },
    { path: "/s/new.jsonl", size: 1, mtimeMs: 100 },
  ];
  syncIndex(idx, files, reader({
    "/s/old.jsonl": [doc("old", "ancient one")],
    "/s/new.jsonl": [doc("new", "recent one")],
  }), { maxDocs: 1 });
  assert.equal(docCount(idx), 1);
  assert.ok(idx.postings["recent"], "newest file won the budget");
  assert.ok(!idx.postings["ancient"]);
});

test("per-doc text is capped", () => {
  const idx = emptyIndex();
  syncIndex(idx, [{ path: "/s/a.jsonl", size: 1, mtimeMs: 1 }], reader({ "/s/a.jsonl": [doc("a", "x".repeat(5000))] }), {
    maxDocChars: 100,
  });
  const only = Object.values(idx.docs)[0]!;
  assert.equal(only.text.length, 100);
});

test("REGRESSION: a term named like an Object.prototype member indexes and is searchable", () => {
  // "constructor" and "__proto__" are words a session about JavaScript will
  // contain. On a plain-object postings map they resolved to the inherited
  // members: `??=` never assigned and `.push` threw, so one such session
  // broke the build for every session.
  const idx = emptyIndex();
  const files: FileRef[] = [{ path: "/s/a.jsonl", size: 10, mtimeMs: 1 }];
  syncIndex(idx, files, reader({
    "/s/a.jsonl": [doc("a", "the constructor sets __proto__ and hasOwnProperty toString valueOf")],
  }));
  assert.deepEqual(idx.postings["constructor"], [1]);
  assert.deepEqual(idx.postings["__proto__"], [1]);
  assert.deepEqual(idx.postings["hasownproperty"] ?? idx.postings["hasOwnProperty"], [1]);
  assert.equal(Object.getPrototypeOf(idx.postings), null, "no prototype to inherit from");
});

test("the live session file is skipped, so a growing session does not dirty the index", () => {
  const idx = emptyIndex();
  const live = "/s/live.jsonl";
  const files: FileRef[] = [
    { path: "/s/a.jsonl", size: 10, mtimeMs: 1 },
    { path: live, size: 10, mtimeMs: 2 },
  ];
  let reads = 0;
  const read = (p: string) => {
    reads++;
    return p === live ? [doc("live", "in progress")] : [doc("a", "finished work")];
  };
  assert.equal(syncIndex(idx, files, read, { skipPath: live }), true);
  assert.equal(reads, 1, "the live file is not read");
  assert.equal(idx.files[live], undefined);

  // The live file grew — the very thing that used to force a full rebuild.
  files[1] = { path: live, size: 900, mtimeMs: 3 };
  reads = 0;
  assert.equal(syncIndex(idx, files, read, { skipPath: live }), false, "nothing changed from the index's point of view");
  assert.equal(reads, 0);

  // Once it is no longer live, it is indexed like any other file.
  assert.equal(syncIndex(idx, files, read), true);
  assert.equal(docCount(idx), 2);
});
