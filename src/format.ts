/**
 * Render search hits into the tool result — bounded, so a broad query can't
 * flood the context. Pure and testable.
 */
import type { SearchHit } from "./types.ts";

const DEFAULT_MAX_CHARS = 8000;

function day(ts: number): string {
  if (!ts) return "";
  try {
    return ` · ${new Date(ts).toISOString().slice(0, 10)}`;
  } catch {
    return "";
  }
}

export function formatHits(query: string, hits: SearchHit[], maxChars = DEFAULT_MAX_CHARS): string {
  if (hits.length === 0) {
    return `No past sessions matched "${query}". Try distinctive terms — an identifier, an error string, a feature name — rather than a full sentence.`;
  }
  const header = `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}", most relevant first:`;
  const lines = [header];
  let used = header.length;
  let shown = 0;
  for (const h of hits) {
    const block = `\n\n[${h.title ?? h.session} · ${h.role}${day(h.ts)}]\n  ${h.snippet}`;
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
