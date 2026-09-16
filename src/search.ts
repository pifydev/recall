/**
 * Query the index and shape the hits.
 *
 * Score by how many distinct query terms a doc contains (from the postings),
 * newest first on a tie. When no term hits at all — a one-character query, a
 * punctuation-heavy phrase, a CJK partial — fall back to a bounded substring
 * scan so the tool still answers instead of returning nothing. Snippets frame
 * the first matching term. Pure and dependency-free.
 */
import { queryTerms } from "./tokenize.ts";
import type { RecallIndex, SearchHit } from "./types.ts";

export interface SearchOptions {
  limit?: number;
  snippetChars?: number;
  /** Skip hits from this file (e.g., the live session). */
  excludePath?: string;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_SNIPPET = 220;

export function search(index: RecallIndex, query: string, opts: SearchOptions = {}): SearchHit[] {
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const snippetChars = opts.snippetChars ?? DEFAULT_SNIPPET;
  const terms = queryTerms(query);

  const scores = new Map<number, number>();
  for (const term of terms) {
    // Own keys only: a query for "constructor" must find sessions that said
    // it, not Object.prototype.constructor — which is not iterable and threw.
    const ids = Object.hasOwn(index.postings, term) ? index.postings[term] : undefined;
    if (!ids) continue;
    for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + 1);
  }

  let ranked: Array<{ id: number; matched: number }>;
  if (scores.size > 0) {
    ranked = [...scores.entries()].map(([id, matched]) => ({ id, matched }));
  } else {
    // Substring fallback for queries the tokenizer can't turn into terms.
    const needle = query.trim().toLowerCase();
    ranked = [];
    if (needle) {
      for (const [idStr, doc] of Object.entries(index.docs)) {
        if (doc.text.toLowerCase().includes(needle)) ranked.push({ id: Number(idStr), matched: 1 });
      }
    }
  }

  ranked.sort((a, b) => {
    if (b.matched !== a.matched) return b.matched - a.matched;
    const da = index.docs[a.id]!;
    const db = index.docs[b.id]!;
    if (db.ts !== da.ts) return db.ts - da.ts;
    return b.id - a.id;
  });

  const hits: SearchHit[] = [];
  for (const { id, matched } of ranked) {
    const doc = index.docs[id]!;
    if (opts.excludePath && doc.path === opts.excludePath) continue;
    hits.push({
      session: doc.session,
      title: doc.title,
      path: doc.path,
      ts: doc.ts,
      role: doc.role,
      snippet: snippet(doc.text, terms, snippetChars),
      matched,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function snippet(text: string, terms: string[], max: number): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  if (pos < 0) {
    const head = clean(text.slice(0, max));
    return text.length > max ? `${head}…` : head;
  }
  const start = Math.max(0, pos - Math.floor(max / 3));
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${clean(text.slice(start, end))}${end < text.length ? "…" : ""}`;
}
