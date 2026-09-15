/**
 * Reading pi's session logs into searchable docs.
 *
 * pi writes one JSONL file per session under <agentDir>/sessions. Each line is
 * an entry; we keep the user prompts and the assistant's text (the signal you
 * actually recall by) and drop tool results, thinking, and everything else that
 * is bulk without being memorable. Bounded per file, tolerant of a corrupt line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Doc } from "./types.ts";
import { isRecord } from "./types.ts";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface SessionFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export function listSessionFiles(dir: string, depth = 0): SessionFile[] {
  if (depth > 4) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const name of names) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) out.push(...listSessionFiles(full, depth + 1));
      else if (name.endsWith(".jsonl") && st.size <= MAX_FILE_BYTES) {
        out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      }
    } catch {
      // race/permission — skip
    }
  }
  return out;
}

export function readSessionDocs(path: string): Doc[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const session = basename(path).replace(/\.jsonl$/, "");
  const docs: Doc[] = [];
  let title: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // pi records a session's display name as a `session_info` entry, and the
    // latest one wins — including when it is written after the messages it
    // will end up labelling, so the title is applied once the file is read.
    const named = sessionInfoName(obj);
    if (named) title = named;
    const doc = docFromEntry(obj, session, path);
    if (doc) docs.push(doc);
  }
  if (title) for (const doc of docs) doc.title = title;
  return docs;
}

/** The display name carried by a pi `session_info` entry, if this is one. */
export function sessionInfoName(entry: unknown): string | undefined {
  if (!isRecord(entry) || entry.type !== "session_info") return undefined;
  const name = entry.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Exposed for tests: turn one parsed entry into a doc, or null to skip it. */
export function docFromEntry(entry: unknown, session: string, path: string): Doc | null {
  if (!isRecord(entry)) return null;
  const message = isRecord(entry.message) ? entry.message : entry;
  const role = typeof message.role === "string" ? message.role : null;
  if (role !== "user" && role !== "assistant") return null;
  const text = extractText(message.content).trim();
  if (!text) return null;
  return { session, path, ts: pickTimestamp(entry, message), role, text };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => isRecord(b) && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function pickTimestamp(entry: Record<string, unknown>, message: Record<string, unknown>): number {
  for (const v of [entry.timestamp, entry.ts, message.timestamp, message.createdAt]) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}
