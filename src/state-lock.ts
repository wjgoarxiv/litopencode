// When a state lock may be taken over. A holder that died before it wrote its owner record leaves an ownerless
// lock, and a pid can come back as another live process (common on WSL), so liveness alone can keep a lock
// forever. No state update holds a lock for ten minutes, so a lock older than that is stale whatever its pid.

/** The hard ceiling: a lock older than this is stale even when its recorded pid is alive. */
export const lockCeilingMs = 10 * 60_000;

/** Whether the process still exists. EPERM means it exists under another user. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

/**
 * Whether a lock `ageMs` old may be taken over. `pid` is its recorded holder, or undefined when there is no
 * readable owner record. Inside the stale window a lock always waits; past it, one with no owner or a dead
 * owner is stale; past the ceiling every lock is.
 */
export function lockIsStale(ageMs: number, staleMs: number, pid: number | undefined): boolean {
  if (ageMs > lockCeilingMs) return true;
  if (ageMs <= staleMs) return false;
  return pid === undefined || !processIsAlive(pid);
}

/** `(held by pid 123, age 42s)` or `(no owner record, age 42s)`, for a timeout message. */
export function lockHolder(pid: number | undefined, ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  return pid === undefined ? `(no owner record, age ${seconds}s)` : `(held by pid ${pid}, age ${seconds}s)`;
}
