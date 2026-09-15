/**
 * Regression: the live (in-progress) session must be excluded from recall
 * results. The extension reads the live session path from ctx.sessionManager,
 * NOT from PI_SESSION_FILE — pi never sets that in the extension's process env,
 * so the old env-only read never excluded anything.
 *
 * This drives the real extensions/recall.ts wiring end to end: it stubs the pi
 * ExtensionAPI to capture the registered tool/command, points getAgentDir() at a
 * temp dir via PI_CODING_AGENT_DIR (injecting the root rather than touching HOME,
 * which bun may cache), and asserts the live session is dropped from the result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import recall from "../extensions/recall.ts";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

interface Captured {
  tool: ToolDefinition<any, any, any>;
  command: { handler: (args: string, ctx: ExtensionContext) => unknown };
}

/** Wire the extension against stub pi, returning the registered tool + command. */
function wire(): Captured {
  let tool: ToolDefinition<any, any, any> | undefined;
  let command: { handler: (args: string, ctx: ExtensionContext) => unknown } | undefined;
  const pi = {
    on() {},
    registerTool(def: ToolDefinition<any, any, any>) {
      if (def.name === "session_search") tool = def;
    },
    registerCommand(_name: string, def: { handler: (args: string, ctx: ExtensionContext) => unknown }) {
      command = def;
    },
  } as unknown as ExtensionAPI;
  recall(pi);
  assert.ok(tool, "session_search tool registered");
  assert.ok(command, "recall command registered");
  return { tool: tool!, command: command! };
}

/** Join the text of a tool result's content blocks. */
function contentText(res: { content: ReadonlyArray<unknown> }): string {
  return res.content
    .map((c) => (c && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .join("\n");
}

/** A minimal ExtensionContext whose session manager reports the live file. */
function makeCtx(liveFile: string | undefined, notified?: string[]): ExtensionContext {
  return {
    hasUI: true,
    ui: { notify: (msg: string) => notified?.push(msg) },
    sessionManager: { getSessionFile: () => liveFile },
  } as unknown as ExtensionContext;
}

/** Set env for the duration of fn, restoring prior values afterward. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function seedSessions(): { root: string; sessions: string; live: string; past: string } {
  const root = mkdtempSync(join(tmpdir(), "recall-live-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const line = (role: string, content: string, ts: number) => JSON.stringify({ timestamp: ts, message: { role, content } });
  const live = join(sessions, "live.jsonl");
  const past = join(sessions, "past.jsonl");
  // Both mention the same distinctive term; live is newer so it would rank first.
  writeFileSync(live, line("user", "quokkaterm in the live session", 2000));
  writeFileSync(past, line("user", "quokkaterm in the past session", 1000));
  return { root, sessions, live, past };
}

test("session_search tool excludes the live session via ctx.sessionManager", async () => {
  const { root, live } = seedSessions();
  try {
    // No PI_SESSION_FILE: the exclusion must come from ctx, not the env.
    await withEnv({ [AGENT_DIR_ENV]: root, PI_SESSION_FILE: undefined }, async () => {
      const { tool } = wire();
      const res = await tool.execute("t1", { query: "quokkaterm" }, undefined, undefined, makeCtx(live));
      const text = contentText(res);
      assert.ok(!text.includes("[live "), `live session must be excluded — got:\n${text}`);
      assert.ok(text.includes("[past "), `past session must be present — got:\n${text}`);
      assert.equal(res.details.count, 1, "only the past session should be returned");
      assert.equal(res.details.indexed, 2, "both sessions are indexed, one is filtered from results");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session_search falls back to PI_SESSION_FILE when ctx has no session file", async () => {
  const { root, live } = seedSessions();
  try {
    await withEnv({ [AGENT_DIR_ENV]: root, PI_SESSION_FILE: live }, async () => {
      const { tool } = wire();
      // ctx reports no live file → the env fallback still excludes it.
      const res = await tool.execute("t1", { query: "quokkaterm" }, undefined, undefined, makeCtx(undefined));
      const text = contentText(res);
      assert.ok(!text.includes("[live "), `env fallback must exclude the live session — got:\n${text}`);
      assert.equal(res.details.count, 1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("/recall search command excludes the live session via ctx.sessionManager", async () => {
  const { root, live } = seedSessions();
  try {
    await withEnv({ [AGENT_DIR_ENV]: root, PI_SESSION_FILE: undefined }, async () => {
      const { command } = wire();
      const notified: string[] = [];
      await command.handler("quokkaterm", makeCtx(live, notified));
      const text = notified.join("\n");
      assert.ok(!text.includes("[live "), `live session must be excluded — got:\n${text}`);
      assert.ok(text.includes("[past "), `past session must be present — got:\n${text}`);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
