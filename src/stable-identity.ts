export type StableStatIdentity = {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
};

export function stableStatIdentity(stat: {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly ctimeMs: number | bigint;
  readonly birthtimeMs: number | bigint;
}): StableStatIdentity {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    ctimeMs: Number(stat.ctimeMs),
    birthtimeMs: Number(stat.birthtimeMs)
  });
}

export function sameStableStatIdentity(left: StableStatIdentity, right: StableStatIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs && left.birthtimeMs === right.birthtimeMs;
}

export function sameStableDirectoryIdentity(left: StableStatIdentity, right: StableStatIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}
