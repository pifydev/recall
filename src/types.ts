/**
 * Shared shapes for @pify/recall. No pi imports — src/ typechecks and
 * unit-tests standalone.
 */

/** One searchable message drawn from a session log. */
export interface Doc {
  /** Session id (the log file's basename without extension). */
  session: string;
  /** Absolute path of the session log this came from. */
  path: string;
  /** Message timestamp in ms, or 0 if unknown. Drives recency ranking. */
  ts: number;
  /** "user" | "assistant" — who said it. */
  role: string;
  /** The message text, bounded to a cap. */
  text: string;
}

/** What we remember about a file so an unchanged one is skipped next time. */
export interface FileMeta {
  size: number;
  mtimeMs: number;
  ids: number[];
}

/**
 * The on-disk index: a per-file fingerprint map, the docs by id, and an
 * inverted index of term → sorted doc ids. Plain JSON, rebuilt incrementally.
 */
export interface RecallIndex {
  version: number;
  nextId: number;
  files: Record<string, FileMeta>;
  docs: Record<number, Doc>;
  postings: Record<string, number[]>;
}

export const INDEX_VERSION = 1;

export function emptyIndex(): RecallIndex {
  return { version: INDEX_VERSION, nextId: 1, files: {}, docs: {}, postings: {} };
}

export interface SearchHit {
  session: string;
  path: string;
  ts: number;
  role: string;
  /** A snippet around the first match, or the head of the message. */
  snippet: string;
  /** How many distinct query terms this doc matched. */
  matched: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
