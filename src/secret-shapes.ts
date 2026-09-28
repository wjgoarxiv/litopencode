// One credential-shape set, shared by every surface that persists text it did not author.
//
// These patterns were proven in the knowledge runtime before they were extracted here. They live in
// one module because a second copy is a second thing to forget when a new credential format
// appears, and a stale copy fails open: it persists the secret it was written to catch.
//
// Detection is shape-based and deliberately conservative about ordinary prose. A caller decides
// what to do with a hit; this module only answers whether the text looks like a credential.

const secretScanCeiling = 64 * 1024;
const c1CsiShape = /\u009B[\u0030-\u003F]*[\u0020-\u002F]*[\u0040-\u007E]/gu;
const c1ControlShape = /[\u0080-\u009F]/gu;
const secretShapeAlternatives = [
  String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`,
  String.raw`(?<![A-Za-z0-9_])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])github_pat[_-][A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`\bsk-[A-Za-z0-9_-]{20,}\b`,
  String.raw`(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`,
  String.raw`(?<![A-Za-z0-9_])(?:xox[baprs]|xapp)-[A-Za-z0-9-]{8,}(?![A-Za-z0-9_-])`,
  String.raw`(?<![A-Za-z0-9_])whsec_[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])hf_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])glpat-[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_])`,
  String.raw`\b(?:authorization|proxy-authorization)\s*:\s*\S+\s+\S+`,
  String.raw`\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])`,
  String.raw`\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:token|secret|key)(?:[_-][A-Za-z0-9]+)*\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b_?auth(?:[_-]?token)?\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`(?<![A-Za-z0-9+.-])(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/?#\s]+@`
] as const;
const shortKeyValueSecretShape = /(?<![A-Za-z0-9_])(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?token|auth[_-]?token|[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:password|passwd|passphrase|secret|token|key)(?:[_-][A-Za-z0-9]+)*)\s*=\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/iu;
const shortUppercaseColonSecretShape = /(?<![A-Za-z0-9_])(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)*[_-](?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|KEY)(?:[_-][A-Z0-9]+)*)\s*:\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/u;

/** The guarded credential shape. Exported so a consumer can read it, never widen it. */
export const secretShape = new RegExp(`(?:${secretShapeAlternatives.join("|")})`, "iu");
const lowercaseTokenShape = /\btoken\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/u;

function normalizedSecretSurface(value: string): string {
  return value.replace(c1CsiShape, " ").replace(c1ControlShape, "");
}

function matchesSecretShape(value: string): boolean {
  return secretShape.test(value) || lowercaseTokenShape.test(value);
}

/** True when the value looks like it carries a credential. Never throws, whatever it is given. */
export function containsSecret(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return false;
  if (Buffer.byteLength(value, "utf8") > secretScanCeiling) return true;
  return matchesSecretShape(normalizedSecretSurface(value));
}

/**
 * The ingress-only extension catches explicit short assignments without changing how old records
 * are validated. Persisted logs must remain readable when this filter grows.
 */
export function containsIngressSecret(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return false;
  if (containsSecret(value)) return true;
  const normalized = normalizedSecretSurface(value);
  return shortKeyValueSecretShape.test(normalized) || shortUppercaseColonSecretShape.test(normalized);
}
