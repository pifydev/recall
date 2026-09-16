/**
 * Naming a session after what it was about.
 *
 * pi stores a session's display name as a `session_info` entry, and without one
 * a past session is only an opaque log id — in the session picker and, more to
 * the point here, in recall's own results. The first thing you type is almost
 * always the best label for the session, so it becomes the name when nothing
 * else has set one.
 *
 * Pure and bounded: the caller does the I/O. Zero dependencies.
 * (Idea from trim21/pi-extensions' session-name.)
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Longest name we will set; the picker truncates well past this anyway. */
const MAX_TITLE = 60;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => isRecord(b) && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * The text of the first thing the user actually typed on this branch. Hidden
 * custom messages (the suite injects several) are not user input and are
 * skipped, so a session is never named after somebody else's plumbing.
 */
export function firstUserText(entries: readonly unknown[]): string {
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (typeof entry.customType === "string") continue; // injected, not typed
    const message = isRecord(entry.message) ? entry.message : entry;
    if (message.role !== "user") continue;
    const text = textOf(message.content).trim();
    if (text) return text;
  }
  return "";
}

/**
 * What to name the session after, given where the hook runs. pi fires
 * before_agent_start with the user's prompt still in a local array — it is
 * appended to the session later, from the agent's own message event — so on
 * a fresh session the branch holds no user text yet and the name must come
 * from the event's prompt. The branch is still preferred: on /resume of an
 * unnamed session it holds the ORIGINAL first prompt, which is what "the
 * first thing you typed" means, not whatever was typed just now.
 */
export function namingText(branch: readonly unknown[], prompt: string | undefined): string {
  return firstUserText(branch) || (prompt ?? "").trim();
}

/**
 * A concise session name from a prompt: first meaningful line, stripped of
 * markdown and shell decoration, cut at a word boundary. Returns "" when there
 * is nothing worth naming the session after (empty, or a bare slash command —
 * "/resume" says nothing about the work).
 */
export function sessionTitle(prompt: string, max: number = MAX_TITLE): string {
  const firstLine = (prompt ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  // A bare slash command is navigation, not a topic.
  if (/^\//.test(firstLine) && !/\s/.test(firstLine)) return "";

  const cleaned = firstLine
    .replace(/^[#>\-*+\s]+/, "") // markdown heading/quote/bullet decoration
    .replace(/[`*_~]+/g, "") // inline markdown
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return trimTail(cleaned);

  // Cut at the last word boundary that fits, rather than mid-word.
  const slice = cleaned.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${trimTail(cut)}…`;
}

/** Drop trailing punctuation that reads badly in a picker. */
function trimTail(text: string): string {
  return text.replace(/[\s,;:.!?-]+$/, "");
}
