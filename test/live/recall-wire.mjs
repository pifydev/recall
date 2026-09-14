/**
 * End-to-end: real session JSONL files on disk → index → search → format,
 * including the incremental-sync skip and a persisted round-trip. Pure JS, so
 * it runs the same under bun or node.
 *
 *   bun run test/live/recall-wire.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const imp = (p) => import(pathToFileURL(join(PKG, "src", p)).href);
const { listSessionFiles, readSessionDocs } = await imp("sessions.ts");
const { syncIndex, docCount } = await imp("index-core.ts");
const { search } = await imp("search.ts");
const { formatHits } = await imp("format.ts");
const { loadIndex, saveIndex } = await imp("persist.ts");
const { emptyIndex } = await imp("types.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const root = mkdtempSync(join(tmpdir(), "recall-e2e-"));
const sessions = join(root, "sessions");
mkdirSync(sessions, { recursive: true });

const line = (role, text, ts) => JSON.stringify({ timestamp: ts, message: { role, content: text } });
writeFileSync(
  join(sessions, "2026-09-10.jsonl"),
  [line("user", "help me wire the OAuth token refresh", 1000), line("assistant", "added refreshToken() to auth.ts", 1001)].join("\n"),
);
writeFileSync(
  join(sessions, "2026-09-12.jsonl"),
  [line("user", "the migration for the users table failed", 5000), line("assistant", "fixed the down migration", 5001)].join("\n"),
);

const idx = emptyIndex();
const files = listSessionFiles(sessions);
check("lists both session files", files.length === 2, `${files.length}`);

const changed = syncIndex(idx, files, readSessionDocs);
check("first sync indexes and reports changed", changed === true && docCount(idx) === 4, `docs=${docCount(idx)}`);

const hits = search(idx, "oauth token refresh");
check("search finds the OAuth session, most-matched first", hits.length > 0 && hits[0].snippet.toLowerCase().includes("oauth"), JSON.stringify(hits[0]?.snippet)?.slice(0, 70));

const migration = search(idx, "migration users table");
check("search finds the migration session", migration.some((h) => h.snippet.toLowerCase().includes("migration")));

// Incremental: an unchanged corpus re-reads nothing and reports no change.
let reads = 0;
const changed2 = syncIndex(idx, listSessionFiles(sessions), (p) => {
  reads++;
  return readSessionDocs(p);
});
check("second sync is a no-op (nothing re-read)", changed2 === false && reads === 0);

// Persisted round-trip.
const indexPath = join(root, "recall", "index.json");
saveIndex(indexPath, idx);
const reloaded = loadIndex(indexPath);
check("persisted index reloads with the same docs", docCount(reloaded) === 4);
check("reloaded index is searchable", search(reloaded, "refreshToken").length > 0);

console.log("\n── formatted result ──");
console.log(formatHits("oauth token refresh", hits));

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exitCode = fail === 0 ? 0 : 1;
