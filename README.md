# @pify/recall

[![CI](https://github.com/pifydev/recall/actions/workflows/ci.yml/badge.svg)](https://github.com/pifydev/recall/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@pify/recall)](https://www.npmjs.com/package/@pify/recall) [![npm downloads](https://img.shields.io/npm/dm/@pify/recall)](https://www.npmjs.com/package/@pify/recall)

Full-text search across your past [pi](https://github.com/earendil-works/pi) sessions. A `session_search` tool over the local session logs, so the agent can recall what it did before — a decision, a fix, a command, a discussion — instead of re-deriving it.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install recall`](https://github.com/pifydev/cli) or `pi install npm:@pify/recall`.

## Why

Everything you and the agent worked through is already on disk: pi writes every session to a JSONL log. But the moment a session ends, that knowledge is unreachable — the next session starts blank, and the agent happily re-solves a problem it cracked last week. Recall makes those logs searchable so "we did this before" becomes a lookup instead of a redo.

## The tool

`session_search` — full-text search over the user prompts and assistant messages in your past sessions.

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | Distinctive terms — an identifier, an error string, a feature name |
| `limit` | number, optional | Max results (default 10, max 25) |

It returns the most relevant snippets with their session id and date, ranked by how many of your query terms each message contains (newest first on a tie). Query with the terms that make a session distinctive, not a whole sentence.

```
3 matches for "oauth token refresh", most relevant first:

[2026-09-10 · assistant · 2026-09-10]
  …added refreshToken() to auth.ts…
```

`/recall` shows the index status; `/recall <query>` searches from the command line; `/recall reindex` rebuilds from scratch.

## Session names

A session with no display name is an opaque log id — in pi's session picker, and in this package's own results. So the first thing you type becomes the session's name, once, and only when nothing else has named it: an existing name (yours, or another extension's) always wins, and the attempt happens at most once per session. A bare slash command (`/resume`) is skipped — it says nothing about the work.

Results are then labelled with that name instead of the id:

```
[add a retry to the uploader · user · 3d ago]
  ...the matching snippet...
```

Names are read back out of pi's own `session_info` entries, so a session you named by hand is labelled correctly too, and a session that never got one still falls back to its id. A fresh session is named from the prompt that starts it (pi has not appended that prompt to the session yet when the hook runs, which is why earlier versions never named anything new); a resumed session keeps its original first prompt as the name. Opt out with `PIFY_RECALL_NO_AUTONAME=1`. (Idea from trim21/pi-extensions.)

## How it works

At session start (and lazily before each search) it syncs an inverted index of your session logs: only files whose size or mtime changed are re-read, so a steady corpus costs almost nothing. The live session is not read at all while it is live — it grows every turn, so it could never look unchanged, and one changed file used to mean rebuilding every posting and rewriting the whole index on every search; it is indexed once it is no longer the one being written, and it never appears in its own results either way. The index is one JSON file under `<agentDir>/recall/`, written atomically; a corrupt or wrong-version file is simply rebuilt. The corpus is bounded (newest sessions win the budget) so it never grows without limit. Words are words: a session that talks about `constructor` or `__proto__` indexes and searches like any other (the postings map has no prototype to collide with).

**Pure JavaScript, no native FTS engine.** `node:sqlite` would be elegant, but it is absent under Bun and flag-gated on Node < 24 — a sqlite index would silently fail for a large share of users. A plain inverted index works on every runtime the suite supports, with **zero runtime dependencies**. Everything is local: no network, no LLM tokens.

Results are snippets from earlier sessions for orientation, not current truth — the tool's own guidance tells the agent to verify against the code as it is now before acting on them.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
