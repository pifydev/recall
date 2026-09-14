import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, uniqueTerms, queryTerms } from "../src/tokenize.ts";

test("tokenize folds case, keeps identifiers, drops 1-char noise", () => {
  assert.deepEqual(tokenize("Read the readFileSync in snake_case!"), [
    "read",
    "the",
    "readfilesync",
    "in",
    "snake_case",
  ]);
  assert.deepEqual(tokenize("a = b + 1"), ["b", "1"].filter((t) => t.length >= 2) /* 'a','b','1' → only ≥2 */);
});

test("single characters and punctuation are not terms", () => {
  assert.deepEqual(tokenize("x y z . , ;"), []);
  assert.deepEqual(tokenize(""), []);
});

test("uniqueTerms dedupes; queryTerms keeps first-seen order", () => {
  assert.deepEqual(uniqueTerms("foo foo bar foo"), ["foo", "bar"]);
  assert.deepEqual(queryTerms("Bar foo BAR"), ["bar", "foo"]);
});

test("unicode letters are kept (a CJK run becomes one token)", () => {
  assert.deepEqual(tokenize("café 日本語"), ["café", "日本語"]);
});
