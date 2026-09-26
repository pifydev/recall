/**
 * Claude Code's own session logs, read as recall docs.
 *
 * Work done on this repository in Claude Code is invisible to session_search
 * because recall indexes only pi's <agentDir>/sessions. Claude Code keeps a
 * parallel record: ~/.claude/projects/<cwd-slug>/*.jsonl, one entry per
 * message, with `type` user/assistant and a `message` whose content is a
 * string or blocks. Only the text is taken — tool_use, tool_result, summary
 * and system entries are skipped — and only for the CURRENT repository's
 * slug, so the corpus stays bounded. Opt-in; fails closed on a shape it
 * does not recognise (tolerant per-line parse, like pi's own logs).
 *
 * Pure apart from the directory resolution; zero dependencies.
 */
import { join } from "node:path";
import { sessionTitle } from "./title.ts";
import type { Doc } from "./types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Claude Code names a project directory after its path with every separator and colon turned into "-". */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[\\/:]/g, "-");
}

/** Where Claude Code keeps this repository's sessions. */
export function claudeProjectDir(cwd: string, home: string): string {
  return join(home, ".claude", "projects", claudeProjectSlug(cwd));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => isRecord(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** One Claude Code JSONL line as a doc, or null. Exposed for tests. */
export function claudeDocFromEntry(entry: unknown, session: string, path: string): Doc | null {
  if (!isRecord(entry)) return null;
  const kind = entry.type;
  if (kind !== "user" && kind !== "assistant") return null;
  const message = isRecord(entry.message) ? entry.message : null;
  if (!message) return null;
  const role = typeof message.role === "string" ? message.role : kind;
  if (role !== "user" && role !== "assistant") return null;
  const text = textOf(message.content).trim();
  if (!text) return null;
  // Claude Code stores tool results as user entries whose content is a tool_result block; textOf skips those.
  let ts = 0;
  if (typeof entry.timestamp === "string") {
    const n = Date.parse(entry.timestamp);
    if (!Number.isNaN(n)) ts = n;
  } else if (typeof entry.timestamp === "number") ts = entry.timestamp;
  return { session, path, ts, role, text };
}

/** Read a Claude Code session log into docs, labelled so a hit says where it came from. */
export function readClaudeDocs(path: string, raw: string): Doc[] {
  const session = path.replace(/\\/g, "/").split("/").pop()!.replace(/\.jsonl$/, "");
  const docs: Doc[] = [];
  let firstTyped: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const doc = claudeDocFromEntry(obj, session, path);
    if (!doc) continue;
    if (firstTyped === undefined && doc.role === "user" && !/^<[a-z-]+>/i.test(doc.text)) firstTyped = doc.text;
    docs.push(doc);
  }
  const title = `claude · ${(firstTyped && sessionTitle(firstTyped)) || session}`;
  for (const doc of docs) doc.title = title;
  return docs;
}
