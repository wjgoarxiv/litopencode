// The plan windows OpenCode 2 can tell a plugin about. Its one usage source is client.usage.limits(): the
// OpenCode Go allowance of the Console workspace the location is signed in to, as a rolling window (five
// hours), a weekly one and a monthly one, each with a percent used; the reply is null when nobody is signed
// in. There are no provider response headers or rate-limit events for a plugin to read, so for any other
// provider this module has nothing to show, and the card draws no figure rather than a made-up one.

export type LimitWindow = { readonly label: "5h" | "1w" | "1mo"; readonly percent: number; readonly limited: boolean };

/** The monthly window is shown only when it is close to the cap, so the card keeps LitClaude's 5h and 1w pair. */
const monthlyShowPercent = 90;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function window(label: LimitWindow["label"], raw: unknown): LimitWindow | undefined {
  const meter = record(raw);
  const percent = meter?.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  return { label, percent: Math.round(Math.min(100, Math.max(0, percent))), limited: meter?.limited === true };
}

/** Reads the usage-limits reply (`{ data: Info | null }` or the bare Info) into the windows worth drawing. */
export function limitWindows(reply: unknown): readonly LimitWindow[] {
  const outer = record(reply);
  const info = outer === undefined ? undefined : "data" in outer ? record(outer.data) : outer;
  const allowance = record(info?.go);
  if (allowance === undefined) return [];
  const rolling = window("5h", allowance.rolling);
  const weekly = window("1w", allowance.weekly);
  const monthly = window("1mo", allowance.monthly);
  return [
    ...(rolling === undefined ? [] : [rolling]),
    ...(weekly === undefined ? [] : [weekly]),
    ...(monthly !== undefined && (monthly.limited || monthly.percent >= monthlyShowPercent) ? [monthly] : [])
  ];
}

export type UsageLimitsOptions = {
  /** Asks the host; absent when the host has no usage source. */
  readonly read: (() => Promise<unknown>) | undefined;
  readonly now: () => number;
  readonly intervalMs: number;
  readonly onChange: () => void;
};

/** A throttled reader: it asks at most once per interval, and a failed or empty answer clears the figures. */
export function createUsageLimits(options: UsageLimitsOptions): { readonly windows: () => readonly LimitWindow[]; readonly poll: () => Promise<void> } {
  let current: readonly LimitWindow[] = [];
  let askedAt: number | undefined;
  let pending: Promise<void> | undefined;

  async function ask(read: () => Promise<unknown>): Promise<void> {
    let next: readonly LimitWindow[];
    try {
      next = limitWindows(await read());
    } catch { // no-excuse-ok: catch -- an unreachable or signed-out host means there is nothing to show, never an error on screen.
      next = [];
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    options.onChange();
  }

  return {
    windows: () => current,
    poll() {
      const read = options.read;
      if (read === undefined) return Promise.resolve();
      if (pending !== undefined) return pending;
      const now = options.now();
      if (askedAt !== undefined && now - askedAt < options.intervalMs) return Promise.resolve();
      askedAt = now;
      pending = ask(read).finally(() => {
        pending = undefined;
      });
      return pending;
    }
  };
}
