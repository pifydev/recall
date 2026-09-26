/**
 * Unprompted recall on the first prompt of a session.
 *
 * The index is otherwise reactive: the agent has to think of calling
 * session_search. "We solved this before" is exactly the thought it does
 * not have. So, opt-in, the first substantial prompt of a session is run
 * against the index and the top hits are handed to the model as a hidden,
 * non-authoritative note. Once per session, tightly capped, and the system
 * prompt is never touched, so the cache holds.
 *
 * Pure: what counts as worth recalling, and how the note is framed.
 */
import type { SearchHit } from "./types.ts";
import { queryTerms } from "./tokenize.ts";

export const AUTORECALL_TYPE = "pify-recall-auto";
export const AUTORECALL_LIMIT = 3;
const MIN_PROMPT_CHARS = 20;
const MIN_TERMS = 3;
const DEFAULT_MAX_CHARS = 2500;

/** A prompt worth searching for: not a slash command, not a one-liner, with enough distinct terms to rank on. */
export function worthRecalling(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length < MIN_PROMPT_CHARS) return false;
  if (text.startsWith("/")) return false;
  return queryTerms(text).length >= MIN_TERMS;
}

function neutralize(text: string): string {
  return text.replaceAll(/<(\/?)recall-auto(\s[^>]*)?>/gi, "&lt;$1recall-auto$2&gt;");
}

/** The hidden note, or null when there is nothing worth saying. */
export function autoRecallBlock(hits: SearchHit[], maxChars: number = DEFAULT_MAX_CHARS): string | null {
  if (hits.length === 0) return null;
  const lines = [
    "<recall-auto>",
    "Snippets from PAST sessions on this machine that share terms with the request. Prior context, not current truth:",
    "verify against the code as it is now before relying on any of it, and use session_search for more.",
    "",
  ];
  let used = lines.join("\n").length;
  let shown = 0;
  for (const h of hits) {
    const day = h.ts ? new Date(h.ts).toISOString().slice(0, 10) : "";
    const block = `[${neutralize(h.title ?? h.session)} · ${h.role}${day ? ` · ${day}` : ""}]\n  ${neutralize(h.snippet)}\n`;
    if (used + block.length > maxChars && shown > 0) break;
    lines.push(block);
    used += block.length;
    shown++;
  }
  lines.push("</recall-auto>");
  return lines.join("\n");
}
