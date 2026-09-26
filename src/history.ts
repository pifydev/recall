/**
 * Search over the CURRENT session's full branch.
 *
 * Recall's index deliberately skips the live session, and @pify/compact keeps
 * only a summary in context once the window fills. The exact detail the
 * summary dropped — a command and what it printed, an error string, a file
 * snippet — is still on the append-only branch pi keeps; nothing let the
 * model reach it. This does: a grep over the entries the session manager
 * hands back, tool results included (that is where commands and errors
 * live), read fresh on every call because the branch grows every turn.
 *
 * Pure: the caller supplies the entries. Zero dependencies.
 */
import { queryTerms, tokenize } from "./tokenize.ts";

export interface HistoryHit {
  /** The entry's durable id, when pi gave it one. */
  id: string | null;
  /** Position on the branch, 0-based — stable within one call. */
  index: number;
  role: string;
  /** Snippet around the first matching term, or the head of the text. */
  snippet: string;
  matched: number;
}

export interface HistorySearchOptions {
  limit?: number;
  snippetChars?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text of a message's content: text blocks, plus tool-call names and arguments, so a command is findable. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "toolCall" && typeof block.name === "string") {
      let args = "";
      try {
        args = JSON.stringify(block.arguments ?? {});
      } catch {
        args = "";
      }
      parts.push(`${block.name}(${args})`);
    }
  }
  return parts.join("\n");
}

/** One branch entry as searchable text, or null when it carries none. */
export function entryText(entry: unknown): { id: string | null; role: string; text: string } | null {
  if (!isRecord(entry)) return null;
  const id = typeof entry.id === "string" ? entry.id : null;
  const message = isRecord(entry.message) ? entry.message : null;
  if (message) {
    const role = typeof message.role === "string" ? message.role : "message";
    const text = contentText(message.content ?? message.output).trim();
    return text ? { id, role, text } : null;
  }
  // Non-message entries worth finding: a compaction summary, a custom entry with text.
  if (entry.type === "compaction" && typeof entry.summary === "string" && entry.summary.trim()) {
    return { id, role: "compaction", text: entry.summary.trim() };
  }
  return null;
}

function snippetAround(text: string, terms: string[], chars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (flat.length <= chars) return flat;
  const start = at === -1 ? 0 : Math.max(0, at - Math.floor(chars / 3));
  const end = Math.min(flat.length, start + chars);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Entries whose text shares terms with the query, best match first, newest first on ties. */
export function searchBranch(entries: readonly unknown[], query: string, opts: HistorySearchOptions = {}): HistoryHit[] {
  const limit = Math.max(1, opts.limit ?? 8);
  const chars = Math.max(40, opts.snippetChars ?? 220);
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scored: HistoryHit[] = [];
  entries.forEach((entry, index) => {
    const e = entryText(entry);
    if (!e) return;
    const have = new Set(tokenize(e.text));
    let matched = 0;
    for (const term of terms) if (have.has(term)) matched++;
    if (matched === 0) return;
    scored.push({ id: e.id, index, role: e.role, snippet: snippetAround(e.text, terms, chars), matched });
  });
  scored.sort((a, b) => b.matched - a.matched || b.index - a.index);
  return scored.slice(0, limit);
}

const DEFAULT_MAX_CHARS = 8000;

/** Render hits for the tool result — bounded, and each line names the entry so a follow-up can point at it. */
export function formatHistory(query: string, hits: HistoryHit[], total: number, maxChars = DEFAULT_MAX_CHARS): string {
  if (hits.length === 0) {
    return `Nothing in this session's ${total} entries matched "${query}". Try a distinctive term — a command, an error string, a file name.`;
  }
  const header = `${hits.length} of this session's ${total} entries match "${query}", best first (this is the full branch, including what compaction summarized away):`;
  const lines = [header];
  let used = header.length;
  let shown = 0;
  for (const h of hits) {
    const block = `\n\n[#${h.index}${h.id ? ` · ${h.id}` : ""} · ${h.role}]\n  ${h.snippet}`;
    if (used + block.length > maxChars && shown > 0) {
      lines.push(`\n\n… ${hits.length - shown} more omitted — narrow the query.`);
      break;
    }
    lines.push(block);
    used += block.length;
    shown++;
  }
  return lines.join("");
}
