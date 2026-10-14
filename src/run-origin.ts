/**
 * Which kind of run a `before_agent_start` event announces.
 *
 * Until pi 1.1 the event fired only for a person's prompt. pi 1.2.0 fires it
 * for runs that `pi.sendMessage(..., { triggerTurn: true })` starts as well —
 * a goal's own continuation, a background job's result, a subagent's report —
 * and marks the difference with `messageType`: `"user"` (prompt, images) or
 * `"custom"` (the starting message, no prompt). A handler that treats every
 * run as a person speaking is wrong on 1.2.0; one that requires
 * `messageType === "user"` is wrong on older pi, which has no such field.
 * Vendored per package, byte-identical; zero dependencies.
 */
export function isUserRun(event: unknown): boolean {
  const type = (event as { messageType?: unknown } | null | undefined)?.messageType;
  return type === undefined || type === "user";
}
