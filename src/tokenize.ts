/**
 * Text → search terms.
 *
 * A word tokenizer over Unicode letters/numbers/underscore: it keeps code
 * identifiers whole (`readFileSync`, `snake_case`), folds case, and drops
 * one-character noise. It is not a stemmer and not a trigram index — recall is
 * "find the session where I touched X", and exact-ish term overlap plus a
 * substring fallback (see search.ts) serves that without a native FTS engine,
 * which keeps the package pure JS on every runtime.
 *
 * CJK and other scriptio-continua text has no spaces, so a run becomes one
 * token; the substring fallback is what makes a partial query still find it.
 */

const WORD = /[\p{L}\p{N}_]+/gu;
const MIN_LEN = 2;

/** All terms in order, lowercased, length ≥ 2. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    const t = m[0].toLowerCase();
    if (t.length >= MIN_LEN) out.push(t);
  }
  return out;
}

/** The distinct terms of a document, for building the inverted index. */
export function uniqueTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/** The query's distinct terms, in first-seen order. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(query)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
