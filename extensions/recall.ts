/**
 * @pify/recall — full-text search across your past pi sessions.
 *
 * pi already writes every session to a JSONL log under <agentDir>/sessions.
 * This indexes the user prompts and assistant text from those logs into a small
 * inverted index (one JSON file) and exposes a `session_search` tool, so the
 * agent can recall what it did before — a prior decision, a fix, a command,
 * a discussion — instead of re-deriving it.
 *
 * Deliberately pure JS: no native FTS engine. node:sqlite is a Node builtin but
 * absent under Bun and flag-gated on Node < 24, so a sqlite index would silently
 * fail for many users; a plain inverted index works on every runtime the suite
 * supports. Zero runtime dependencies, local-only — no network, no LLM tokens.
 *
 * The index syncs incrementally: only session files whose size+mtime changed
 * are re-read, at session start (fire-and-forget) and lazily before a search.
 */
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";

import { loadIndex, saveIndex } from "../src/persist.ts";
import { listSessionFiles, readSessionDocs } from "../src/sessions.ts";
import { syncIndex, docCount } from "../src/index-core.ts";
import { search } from "../src/search.ts";
import { formatHits } from "../src/format.ts";
import { namingText, sessionTitle } from "../src/title.ts";
import { emptyIndex, type RecallIndex } from "../src/types.ts";

type UiContext = ExtensionContext;

export default function recall(pi: ExtensionAPI) {
  let index: RecallIndex = emptyIndex();
  let loaded = false;
  let indexPath = "";
  let sessionsDir = "";

  function paths(): void {
    const dir = getAgentDir();
    indexPath = join(dir, "recall", "index.json");
    sessionsDir = join(dir, "sessions");
  }

  /**
   * Load once, then bring the index up to date against the session files.
   * The live session is skipped: it grows every turn, so it can never look
   * unchanged, and one changed file meant rebuilding every posting and
   * rewriting the whole index on every search. Its hits are excluded from
   * results anyway; it is indexed once it is no longer the live one.
   */
  function sync(livePath?: string): void {
    if (!indexPath) paths();
    if (!loaded) {
      index = loadIndex(indexPath);
      loaded = true;
    }
    const files = listSessionFiles(sessionsDir);
    if (syncIndex(index, files, readSessionDocs, { skipPath: livePath })) saveIndex(indexPath, index);
  }

  /** The file pi is writing this session into, when the host can say. */
  function liveFile(ctx: { sessionManager?: { getSessionFile?: () => string | undefined } } | undefined): string | undefined {
    try {
      return ctx?.sessionManager?.getSessionFile?.() ?? process.env.PI_SESSION_FILE ?? undefined;
    } catch {
      return undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    paths();
    named = false;
    const live = liveFile(ctx);
    // Fire-and-forget: never delay session start on indexing.
    const t = setTimeout(() => {
      try {
        sync(live);
      } catch {
        // A recall index is a cache; a failed build must not surface.
      }
    }, 0);
    t.unref?.();
  });

  /** Whether this session's naming attempt has already happened. */
  let named = false;

  // A session with no display name is an opaque log id — in pi's picker and in
  // this package's own results. The first thing you typed is the best label, so
  // set it once, only when nothing else has named the session. Best-effort and
  // never destructive: an existing name (yours or another extension's) wins.
  // Opt out with PIFY_RECALL_NO_AUTONAME=1.
  pi.on("before_agent_start", async (event, ctx) => {
    if (named) return;
    if (process.env.PIFY_RECALL_NO_AUTONAME === "1") {
      named = true;
      return;
    }
    try {
      if (ctx.sessionManager.getSessionName()) {
        named = true;
        return;
      }
      // The prompt is not in the branch yet when this fires (pi appends it
      // later, from the agent's message event), so on a fresh session the
      // branch alone yielded "" and the session was never named. The event
      // carries the prompt; the branch still wins when it has one.
      const prompt = (event as { prompt?: string }).prompt;
      const title = sessionTitle(namingText(ctx.sessionManager.getBranch() as unknown[], prompt));
      // Only a produced name ends the attempt: a first prompt that yields
      // nothing (a bare slash command) leaves the next turn its chance.
      if (title) {
        pi.setSessionName(title);
        named = true;
      }
    } catch {
      // Naming is a nicety; it must never interfere with a turn.
    }
  });

  pi.registerTool({
    name: "session_search",
    label: "Search past sessions",
    promptSnippet: "Search your earlier pi sessions for what you did before",
    promptGuidelines: [
      "Search past sessions before re-deriving something you may have solved already, or when the user refers to earlier work (\"like we did last time\", \"the thing from yesterday\").",
      "Query with distinctive terms — an identifier, an error string, a file or feature name — not a whole sentence; term overlap is what ranks a hit.",
      "Results are snippets from prior sessions for orientation, not current truth: verify against the code as it is now before acting on them.",
    ],
    description:
      "Full-text search across this machine's past pi session logs (user prompts and assistant messages). " +
      "Returns the most relevant snippets with their session id and date. Local only — no network. Use it to " +
      "recall earlier decisions, fixes, commands, or discussions instead of starting from scratch.",
    parameters: Type.Object({
      query: Type.String({ description: "Distinctive search terms (identifiers, error text, feature names)" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10, max 25)" })),
    }),
    async execute(
      _id,
      params: { query: string; limit?: number },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: Record<string, unknown>;
      isError?: boolean;
    }> {
      const query = String(params.query ?? "").trim();
      if (!query) return { content: [{ type: "text", text: "Empty query." }], details: {}, isError: true };
      // Skip the live session so recall never echoes the conversation in progress.
      // The path comes from the session manager; pi does not set PI_SESSION_FILE in
      // the extension's process env, so read ctx first and keep the env as a fallback.
      const excludePath = liveFile(ctx);
      try {
        sync(excludePath);
      } catch {
        // fall through to a search over whatever is already loaded
      }
      const limit = Math.max(1, Math.min(25, Math.round(params.limit ?? 10)));
      const hits = search(index, query, { limit, excludePath });
      return {
        content: [{ type: "text", text: formatHits(query, hits) }],
        details: { count: hits.length, indexed: docCount(index) },
      };
    },
  });

  pi.registerCommand("recall", {
    description: "Recall index status, or search: /recall [reindex | <query>]",
    handler: async (args, ctx: UiContext) => {
      if (!ctx.hasUI) return;
      const arg = (args ?? "").trim();
      const excludePath = liveFile(ctx);
      if (arg === "" || arg === "status") {
        try {
          sync(excludePath);
        } catch {
          // best-effort
        }
        const files = Object.keys(index.files).length;
        ctx.ui.notify(`Recall: ${docCount(index)} messages indexed from ${files} sessions.`, "info");
        return;
      }
      if (arg === "reindex") {
        index = emptyIndex();
        loaded = true;
        try {
          sync(excludePath);
        } catch {
          // best-effort
        }
        ctx.ui.notify(`Recall reindexed: ${docCount(index)} messages.`, "info");
        return;
      }
      try {
        sync(excludePath);
      } catch {
        // best-effort
      }
      const hits = search(index, arg, { limit: 10, excludePath });
      ctx.ui.notify(formatHits(arg, hits), "info");
    },
  });
}
