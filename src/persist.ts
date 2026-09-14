/**
 * Load and save the index as one JSON file, atomically and version-guarded.
 * A wrong-version, corrupt, or missing file just yields a fresh empty index
 * rather than throwing — a stale index is a cache, never a source of truth.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emptyIndex, INDEX_VERSION, isRecord, type RecallIndex } from "./types.ts";

export function loadIndex(path: string): RecallIndex {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (
      isRecord(raw) &&
      raw.version === INDEX_VERSION &&
      isRecord(raw.files) &&
      isRecord(raw.docs) &&
      isRecord(raw.postings) &&
      typeof raw.nextId === "number"
    ) {
      return raw as unknown as RecallIndex;
    }
  } catch {
    // missing or corrupt — start clean
  }
  return emptyIndex();
}

export function saveIndex(path: string, index: RecallIndex): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(index));
    renameSync(tmp, path);
  } catch {
    // An index we cannot persist still works for this session in memory.
  }
}
