/**
 * The inverted index: build it incrementally, keep it bounded.
 *
 * `syncIndex` brings the index up to date against the current session files.
 * It reads only files whose size+mtime changed, drops the docs of removed or
 * changed files, caps the total number of docs (keeping the newest sessions),
 * then rebuilds the term→ids postings from the surviving docs in one pass.
 * Pure: the caller injects a `readDocs(path)` so this never touches the disk
 * itself and is fully unit-testable.
 */
import { uniqueTerms } from "./tokenize.ts";
import type { Doc, RecallIndex } from "./types.ts";

export interface FileRef {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface SyncOptions {
  /** Hard cap on indexed docs; newest files win the budget. */
  maxDocs?: number;
  /** Per-doc text cap so one huge message can't dominate the index. */
  maxDocChars?: number;
  /**
   * The session file being written right now. It grows every turn, so its
   * size and mtime never match what was recorded — and one changed file
   * meant re-reading it, rebuilding every posting in the corpus and rewriting
   * the whole index on EVERY search. Its hits are excluded from results
   * anyway; it is indexed once it is no longer live.
   */
  skipPath?: string;
}

const DEFAULT_MAX_DOCS = 20_000;
const DEFAULT_MAX_DOC_CHARS = 2000;

export function syncIndex(
  index: RecallIndex,
  files: FileRef[],
  readDocs: (path: string) => Doc[],
  opts: SyncOptions = {},
): boolean {
  const maxDocs = opts.maxDocs ?? DEFAULT_MAX_DOCS;
  const maxChars = opts.maxDocChars ?? DEFAULT_MAX_DOC_CHARS;
  let changed = false;

  // Drop files that no longer exist, and their docs.
  const present = new Set(files.map((f) => f.path));
  for (const path of Object.keys(index.files)) {
    if (!present.has(path)) {
      for (const id of index.files[path]!.ids) delete index.docs[id];
      delete index.files[path];
      changed = true;
    }
  }

  // Newest first, so the doc cap keeps the most recent sessions.
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  let docCount = Object.keys(index.docs).length;

  for (const f of sorted) {
    if (opts.skipPath !== undefined && f.path === opts.skipPath) continue; // live: read later
    const known = index.files[f.path];
    if (known && known.size === f.size && known.mtimeMs === f.mtimeMs) continue; // unchanged

    if (known) {
      for (const id of known.ids) delete index.docs[id];
      docCount -= known.ids.length;
    }
    changed = true;

    const ids: number[] = [];
    if (docCount < maxDocs) {
      for (const doc of readDocs(f.path)) {
        if (docCount >= maxDocs) break;
        const id = index.nextId++;
        index.docs[id] = { ...doc, text: doc.text.slice(0, maxChars) };
        ids.push(id);
        docCount++;
      }
    }
    index.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, ids };
  }

  if (changed) rebuildPostings(index);
  return changed;
}

/**
 * Rebuild term→ids from the current docs. Cheap for a bounded corpus.
 *
 * The map has no prototype. A term is any word a session contained, and
 * "constructor" or "__proto__" are words: on a plain object those resolve to
 * the inherited members, so `??=` never assigned and `.push` threw — one
 * session mentioning a constructor broke the build for every session.
 */
function rebuildPostings(index: RecallIndex): void {
  const postings: Record<string, number[]> = Object.create(null);
  const ids = Object.keys(index.docs)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of ids) {
    for (const term of uniqueTerms(index.docs[id]!.text)) {
      (postings[term] ??= []).push(id);
    }
  }
  index.postings = postings;
}

export function docCount(index: RecallIndex): number {
  return Object.keys(index.docs).length;
}
