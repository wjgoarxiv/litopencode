// Hand-rolled glob matcher for repository rule scoping.
//
// This engine ships with zero runtime dependencies, so the `.cursor/rules` glob dialect is
// implemented here rather than vendored. The supported subset is deliberate: `**`, `*`, `?`,
// `{a,b}` (nested), `[seq]` / `[!seq]`, and a leading `!` negation. Extglobs (`@(a|b)`, `!(a)`,
// `+(a)`, `*(a)`, `?(a)`), POSIX classes, and backslash escaping are NOT supported, because rule
// authors do not use them and every one of them costs correctness elsewhere.
//
// Divergences from picomatch are measured, not asserted: tools/run-rules-glob-differential.mjs
// compiles the same corpus through both and writes the comparison to evidence. A written list is a
// claim; the harness is the proof.

const globCacheLimit = 512;
const globCache = new Map<string, RegExp>();

export const globComplexityLimits = Object.freeze({
  maxPatterns: 64,
  maxPatternCharacters: 512,
  maxBraceDepth: 16,
  maxBraceExpansions: 256
});

export type GlobMatcher = (candidatePath: string) => boolean;

// A pattern is a directory anchor when it ends in `/`: `src/` scopes the whole subtree.
function normalizePattern(pattern: string): string {
  let value = pattern.trim().replace(/\\/gu, "/");
  while (value.startsWith("./")) value = value.slice(2);
  if (value.startsWith("/")) value = value.slice(1);
  if (value.endsWith("/")) value = `${value}**`;
  // `src/**/**` and `src/**` mean the same subtree; collapsing keeps the trailing-globstar rule below
  // from seeing a doubled tail.
  return value.replace(/(?:\/\*\*)+$/u, "/**");
}

export function normalizeRelativePath(candidatePath: string): string {
  let value = candidatePath.trim().replace(/\\/gu, "/");
  while (value.startsWith("./")) value = value.slice(2);
  if (value.startsWith("/")) value = value.slice(1);
  return value;
}

// Brace expansion runs before regex translation so `{a,b}` never has to be expressed as an
// alternation inside the compiled pattern, where a nested comma would be ambiguous.
function expandBracesInto(pattern: string, recursionDepth: number, expanded: string[]): void {
  if (recursionDepth > globComplexityLimits.maxBraceDepth) throw new RangeError("brace expansion limit exceeded: nesting depth");
  const open = pattern.indexOf("{");
  if (open === -1) {
    if (expanded.length >= globComplexityLimits.maxBraceExpansions) {
      throw new RangeError("brace expansion limit exceeded: alternatives");
    }
    expanded.push(pattern);
    return;
  }

  let depth = 0;
  let close = -1;
  const alternatives: string[] = [];
  let current = "";
  for (let index = open; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        alternatives.push(current);
        break;
      }
    } else if (character === "," && depth === 1) {
      alternatives.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  // An unbalanced brace is a literal brace, matching how rule authors actually write paths.
  if (close === -1) {
    if (expanded.length >= globComplexityLimits.maxBraceExpansions) {
      throw new RangeError("brace expansion limit exceeded: alternatives");
    }
    expanded.push(pattern);
    return;
  }

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  for (const alternative of alternatives) expandBracesInto(`${prefix}${alternative}${suffix}`, recursionDepth + 1, expanded);
}

export function expandBraces(pattern: string): readonly string[] {
  if (pattern.length > globComplexityLimits.maxPatternCharacters) {
    throw new RangeError("brace expansion limit exceeded: pattern length");
  }
  const expanded: string[] = [];
  expandBracesInto(pattern, 0, expanded);
  return expanded;
}

function escapeLiteral(character: string): string {
  return /[.+^$(){}|[\]\\]/u.test(character) ? `\\${character}` : character;
}

function translateCharacterClass(pattern: string, start: number): { readonly source: string; readonly next: number } | undefined {
  let index = start + 1;
  let negated = false;
  if (pattern[index] === "!" || pattern[index] === "^") {
    negated = true;
    index += 1;
  }
  let body = "";
  // A `]` immediately after the opening bracket is a literal `]`.
  if (pattern[index] === "]") {
    body += "\\]";
    index += 1;
  }
  while (index < pattern.length && pattern[index] !== "]") {
    const character = pattern[index];
    body += character === "\\" ? "\\\\" : character === "[" ? "\\[" : character;
    index += 1;
  }
  if (index >= pattern.length) return undefined;
  if (body === "") return undefined;
  return { source: `[${negated ? "^" : ""}${body}]`, next: index + 1 };
}

export function globRegexSource(pattern: string): string {
  let value = normalizePattern(pattern);
  // A trailing `/**` covers the directory itself as well as everything under it, so `src/**` matches
  // `src`. Measured against picomatch 4.0.5, which agrees.
  const trailingSubtree = value.endsWith("/**");
  if (trailingSubtree) value = value.slice(0, -3);
  let source = "";
  let index = 0;

  while (index < value.length) {
    const character = value[index];

    if (character === "*") {
      const doubled = value[index + 1] === "*";
      if (doubled) {
        const beforeIsBoundary = index === 0 || value[index - 1] === "/";
        const afterSlash = value[index + 2] === "/";
        const atEnd = index + 2 >= value.length;
        if (beforeIsBoundary && afterSlash) {
          // `**/` spans zero or more whole segments.
          source += "(?:[^/]*/)*";
          index += 3;
          continue;
        }
        if (beforeIsBoundary && atEnd) {
          // A trailing `**` spans the rest of the path, including nothing at all.
          source += ".*";
          index += 2;
          continue;
        }
        // A `**` that is not segment-aligned degrades to `*`, which is what picomatch does too.
        source += "[^/]*";
        index += 2;
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    if (character === "[") {
      const translated = translateCharacterClass(value, index);
      if (translated !== undefined) {
        source += translated.source;
        index = translated.next;
        continue;
      }
      source += "\\[";
      index += 1;
      continue;
    }

    source += escapeLiteral(character);
    index += 1;
  }

  return `^${source}${trailingSubtree ? "(?:/.*)?" : ""}$`;
}

function compile(pattern: string): RegExp | undefined {
  const cached = globCache.get(pattern);
  if (cached !== undefined) return cached;

  let sources: readonly string[];
  try {
    sources = expandBraces(pattern).map(globRegexSource);
  } catch {
    return undefined;
  }
  // A `/**` suffix should also match the directory itself, so `src/**` covers `src`.
  const compiled = new RegExp(sources.map((source) => `(?:${source})`).join("|"), "u");
  if (globCache.size >= globCacheLimit) globCache.clear();
  globCache.set(pattern, compiled);
  return compiled;
}

export function matchGlob(pattern: string, candidatePath: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === "") return false;
  const negated = trimmed.startsWith("!");
  const effective = negated ? trimmed.slice(1) : trimmed;
  const matched = compile(effective)?.test(normalizeRelativePath(candidatePath)) ?? false;
  return negated ? !matched : matched;
}

// A rule's scope is the whole pattern list: positives grant, negations veto. An all-negative list
// is treated as "everything except", which is how .gitignore-shaped rule lists read.
export function createGlobMatcher(patterns: readonly string[]): GlobMatcher {
  if (
    patterns.length > globComplexityLimits.maxPatterns ||
    patterns.some((pattern) => pattern.length > globComplexityLimits.maxPatternCharacters)
  ) return () => false;
  const cleaned = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern !== "");
  if (cleaned.length === 0) return () => false;
  const negations = cleaned.filter((pattern) => pattern.startsWith("!"));
  const positives = cleaned.filter((pattern) => !pattern.startsWith("!"));

  return (candidatePath: string) => {
    const normalized = normalizeRelativePath(candidatePath);
    if (negations.some((pattern) => !matchGlob(pattern, normalized))) return false;
    if (positives.length === 0) return true;
    return positives.some((pattern) => matchGlob(pattern, normalized));
  };
}
