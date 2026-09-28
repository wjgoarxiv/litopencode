import type { Pair, ParsedNode } from "yaml";
import { expandBraces } from "./glob.ts";

type YamlModule = typeof import("yaml");

const yaml = await import("yaml").catch(() => undefined);

export type RuleFrontmatter = {
  readonly description: string;
  readonly globs: readonly string[];
  readonly scopeDeclared: boolean;
  readonly alwaysApply: boolean | undefined;
  readonly malformed: boolean;
};

export type ParsedRuleFile = {
  readonly frontmatter: RuleFrontmatter;
  readonly body: string;
};

export const ruleScopeLimits = Object.freeze({
  maxGlobs: 64,
  maxGlobCharacters: 512
});

const emptyFrontmatter: RuleFrontmatter = {
  description: "",
  globs: [],
  scopeDeclared: false,
  alwaysApply: undefined,
  malformed: false
};

const scopeKeys = new Set(["globs", "applyto", "paths"]);

type FrontmatterBlock = {
  readonly block: string;
  readonly body: string;
  readonly terminated: boolean;
};

function extractFrontmatter(text: string): FrontmatterBlock | undefined {
  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1 || text.slice(0, firstBreak).replace(/\r$/u, "") !== "---") return undefined;

  let cursor = firstBreak + 1;
  while (cursor <= text.length) {
    const nextBreak = text.indexOf("\n", cursor);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    if (text.slice(cursor, lineEnd).replace(/\r$/u, "") === "---") {
      return {
        block: text.slice(firstBreak + 1, cursor),
        body: nextBreak === -1 ? "" : text.slice(nextBreak + 1).trim(),
        terminated: true
      };
    }
    if (nextBreak === -1) break;
    cursor = nextBreak + 1;
  }

  return { block: text.slice(firstBreak + 1), body: text.trim(), terminated: false };
}

function scalarKey(pair: Pair<ParsedNode, ParsedNode | null>, parser: YamlModule): string | undefined {
  if (!parser.isScalar(pair.key) || typeof pair.key.value !== "string") return undefined;
  return pair.key.value.toLowerCase();
}

function lexicalTopLevelScope(block: string): boolean {
  return block.split(/\r?\n/u).some((line) => /^(?:globs|applyTo|paths)\s*:/iu.test(line));
}

function splitPlainList(value: string): readonly string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "{") braceDepth += 1;
    else if (character === "}") {
      if (braceDepth === 0) return undefined;
      braceDepth -= 1;
    } else if (character === "[") bracketDepth += 1;
    else if (character === "]") {
      if (bracketDepth === 0) return undefined;
      bracketDepth -= 1;
    } else if (character === "," && braceDepth === 0 && bracketDepth === 0) {
      const part = value.slice(start, index).trim();
      if (part === "") return undefined;
      parts.push(part);
      start = index + 1;
    }
  }
  if (braceDepth !== 0 || bracketDepth !== 0) return undefined;
  const tail = value.slice(start).trim();
  if (tail === "") return undefined;
  parts.push(tail);
  return parts;
}

function scopeNodeValues(key: string, node: ParsedNode | null, parser: YamlModule): readonly string[] | undefined {
  if (parser.isSeq(node)) {
    const values: string[] = [];
    for (const item of node.items) {
      if (!parser.isScalar(item) || typeof item.value !== "string" || item.value.trim() === "") return undefined;
      values.push(item.value.trim());
    }
    return values;
  }
  if (!parser.isScalar(node) || typeof node.value !== "string" || node.value.trim() === "") return undefined;
  const value = node.value.trim();
  const splitScalar = key === "applyto" || node.type === "PLAIN";
  return splitScalar ? splitPlainList(value) : [value];
}

function parseAlwaysApply(node: ParsedNode | null, parser: YamlModule): boolean | undefined {
  if (!parser.isScalar(node)) return undefined;
  if (typeof node.value === "boolean") return node.value;
  if (typeof node.value !== "string") return undefined;
  const value = node.value.trim().toLowerCase();
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  return undefined;
}

function validGlobList(globs: readonly string[]): boolean {
  if (globs.length === 0 || globs.length > ruleScopeLimits.maxGlobs) return false;
  for (const glob of globs) {
    if (glob.length > ruleScopeLimits.maxGlobCharacters) return false;
    try {
      expandBraces(glob);
    } catch {
      return false;
    }
  }
  return true;
}

export function parseRuleFile(text: string): ParsedRuleFile {
  const extracted = extractFrontmatter(text);
  if (extracted === undefined) return { frontmatter: emptyFrontmatter, body: text.trim() };

  // Keep the package entry importable for the existing pre-install tarball probe. Normal consumers
  // receive yaml through dependencies; if it is absent, frontmatter fails closed instead of turning a
  // declared scope into repository-wide guidance.
  if (yaml === undefined) {
    return {
      frontmatter: { ...emptyFrontmatter, scopeDeclared: true, malformed: true },
      body: extracted.body
    };
  }

  const document = yaml.parseDocument(extracted.block, { strict: true, uniqueKeys: true });
  const pairs = yaml.isMap(document.contents) ? document.contents.items : [];
  const scopePairs = pairs.filter((pair) => {
    const key = scalarKey(pair, yaml);
    return key !== undefined && scopeKeys.has(key);
  });
  const scopeDeclared = scopePairs.length > 0 || lexicalTopLevelScope(extracted.block);
  let malformed = document.errors.length > 0 || !extracted.terminated;
  let description = "";
  let alwaysApply: boolean | undefined;
  const collected: string[] = [];

  for (const pair of pairs) {
    const key = scalarKey(pair, yaml);
    if (key === "description" && yaml.isScalar(pair.value) && pair.value.value !== null) {
      description = String(pair.value.value);
    } else if (key === "alwaysapply") {
      alwaysApply = parseAlwaysApply(pair.value, yaml);
    } else if (key !== undefined && scopeKeys.has(key)) {
      const values = scopeNodeValues(key, pair.value, yaml);
      if (values === undefined) malformed = true;
      else collected.push(...values);
    }
  }

  const globs = Object.freeze([...new Set(collected)]);
  if (scopeDeclared && !validGlobList(globs)) malformed = true;

  return {
    frontmatter: {
      description,
      globs: malformed && scopeDeclared ? [] : globs,
      scopeDeclared,
      alwaysApply,
      malformed
    },
    body: extracted.body
  };
}
