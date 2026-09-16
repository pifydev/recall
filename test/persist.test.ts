import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndex, saveIndex } from "../src/persist.ts";
import { emptyIndex, INDEX_VERSION } from "../src/types.ts";

test("save then load round-trips the index", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-persist-"));
  try {
    const p = join(dir, "recall", "index.json");
    const idx = emptyIndex();
    idx.nextId = 5;
    idx.docs[1] = { session: "s", path: "/p", ts: 0, role: "user", text: "hello" };
    idx.postings["hello"] = [1];
    saveIndex(p, idx);
    const back = loadIndex(p);
    assert.equal(back.nextId, 5);
    assert.deepEqual(back.postings["hello"], [1]);
    assert.equal(back.docs[1]!.text, "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file yields a fresh empty index", () => {
  const back = loadIndex("/no/such/recall/index.json");
  assert.equal(back.version, INDEX_VERSION);
  assert.equal(Object.keys(back.docs).length, 0);
});

test("a wrong-version or corrupt file is discarded, not thrown", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-bad-"));
  try {
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ version: 999, files: {}, docs: {}, postings: {}, nextId: 1 }));
    assert.equal(Object.keys(loadIndex(p).docs).length, 0, "wrong version → empty");
    writeFileSync(p, "{ not json");
    assert.equal(loadIndex(p).version, INDEX_VERSION, "corrupt → empty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REGRESSION: a persisted __proto__/constructor term survives the JSON round trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-persist-"));
  try {
    const p = join(dir, "recall", "index.json");
    const idx = emptyIndex();
    idx.docs[1] = { session: "s", path: "/p", ts: 0, role: "user", text: "constructor __proto__" };
    idx.postings["constructor"] = [1];
    idx.postings["__proto__"] = [1];
    saveIndex(p, idx);
    const back = loadIndex(p);
    assert.equal(Object.getPrototypeOf(back.postings), null);
    assert.deepEqual(back.postings["constructor"], [1]);
    assert.deepEqual(back.postings["__proto__"], [1]);
    assert.ok(Object.hasOwn(back.postings, "__proto__"), "a plain key, not the prototype link");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
