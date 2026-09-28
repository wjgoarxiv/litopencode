import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRuleFile, type RuleFrontmatter } from "./frontmatter.ts";

// Where repository rules live, and which one wins when two disagree.
//
// Lower priority number wins. The ladder runs product-owned first, then the other assistants'
// conventions in the order a repository is likely to have adopted them, then user-home defaults,
// then the rules bundled with this package. A repository's own statement always outranks a machine
// default, which is the property that makes the ordering safe to apply without asking.

export type RuleSourceId =
  | "project-litopencode"
  | "project-litcodex"
  | "project-claude"
  | "project-cursor"
  | "project-github-instructions"
  | "project-copilot-instructions"
  | "project-context"
  | "user-litopencode"
  | "user-claude"
  | "user-cursor"
  | "bundled";

export const sourcePriority: Readonly<Record<RuleSourceId, number>> = Object.freeze({
  "project-litopencode": 10,
  "project-litcodex": 20,
  "project-claude": 30,
  "project-cursor": 40,
  "project-github-instructions": 50,
  "project-copilot-instructions": 60,
  "project-context": 70,
  "user-litopencode": 80,
  "user-claude": 90,
  "user-cursor": 100,
  bundled: 110
});

type ProjectLocation = {
  readonly id: RuleSourceId;
  readonly relativePath: string;
  readonly kind: "directory" | "file";
};

// Scanned at every directory level from the edited file up to the project root, so a nested
// package can carry rules that outrank the repository root by directory distance.
const projectLocations: readonly ProjectLocation[] = Object.freeze([
  { id: "project-litopencode", relativePath: path.join(".litopencode", "rules"), kind: "directory" },
  { id: "project-litcodex", relativePath: path.join(".litcodex", "rules"), kind: "directory" },
  { id: "project-claude", relativePath: path.join(".claude", "rules"), kind: "directory" },
  { id: "project-cursor", relativePath: path.join(".cursor", "rules"), kind: "directory" },
  { id: "project-github-instructions", relativePath: path.join(".github", "instructions"), kind: "directory" },
  { id: "project-copilot-instructions", relativePath: path.join(".github", "copilot-instructions.md"), kind: "file" },
  { id: "project-context", relativePath: "CONTEXT.md", kind: "file" }
]);

const userLocations: readonly ProjectLocation[] = Object.freeze([
  { id: "user-litopencode", relativePath: path.join(".litopencode", "rules"), kind: "directory" },
  { id: "user-claude", relativePath: path.join(".claude", "rules"), kind: "directory" },
  { id: "user-cursor", relativePath: path.join(".cursor", "rules"), kind: "directory" }
]);

const ruleExtensions = new Set([".md", ".mdc", ".markdown", ".txt"]);

// Distances for sources that are not anchored to a directory in the project tree. They sort after
// every in-project rule regardless of nesting depth.
const userDistance = 1_000;
const bundledDistance = 2_000;

export type DiscoveredRule = {
  readonly id: string;
  readonly sourceId: RuleSourceId;
  readonly filePath: string;
  // The directory level the rule was found under. A rule in packages/a/.cursor/rules scopes globs
  // relative to packages/a, so `src/*.ts` there means packages/a/src/*.ts.
  readonly scopeDir: string;
  readonly priority: number;
  readonly distance: number;
  readonly isGlobal: boolean;
  readonly frontmatter: RuleFrontmatter;
  readonly body: string;
};

export type DiscoveryOptions = {
  readonly projectRoot: string;
  readonly startDir?: string;
  readonly homeDir?: string;
  readonly bundledRulesDir?: string;
  readonly limits?: Partial<RuleDiscoveryLimits>;
  readonly onDiagnostic?: (diagnostic: RuleDiscoveryDiagnostic) => void;
};

export type RuleDiscoveryLimits = {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxScannedEntries: number;
};

export type RuleDiscoveryDiagnostic = {
  readonly code: "rule_file_count_limit" | "rule_file_bytes_limit" | "rule_total_bytes_limit" | "rule_scan_entry_limit";
  readonly path: string;
  readonly limit: number;
};

export const ruleDiscoveryLimits: RuleDiscoveryLimits = Object.freeze({
  maxFiles: 256,
  maxFileBytes: 128 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxScannedEntries: 4_096
});

type DiscoveryBudget = {
  readonly limits: RuleDiscoveryLimits;
  readonly onDiagnostic?: (diagnostic: RuleDiscoveryDiagnostic) => void;
  filesSeen: number;
  scannedEntries: number;
  totalBytes: number;
  blocked: boolean;
};

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function diagnostic(budget: DiscoveryBudget, entry: RuleDiscoveryDiagnostic): void {
  budget.onDiagnostic?.(Object.freeze(entry));
}

function registerRuleFile(filePath: string, budget: DiscoveryBudget): boolean {
  budget.filesSeen += 1;
  if (budget.filesSeen <= budget.limits.maxFiles) return true;
  if (!budget.blocked) {
    diagnostic(budget, { code: "rule_file_count_limit", path: filePath, limit: budget.limits.maxFiles });
  }
  budget.blocked = true;
  return false;
}

async function readIfFile(
  filePath: string,
  containmentRoot: string | undefined,
  budget: DiscoveryBudget,
  register: boolean
): Promise<string | undefined> {
  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    const stat = await fs.lstat(filePath);
    // A symbolic link is not followed: a rule file is content this engine injects into a prompt, and
    // a link can point outside the repository the user approved.
    if (!stat.isFile()) return undefined;
    if (register && !registerRuleFile(filePath, budget)) return undefined;
    const canonical = await fs.realpath(filePath);
    if (containmentRoot !== undefined && !isContainedPath(containmentRoot, canonical)) return undefined;
    handle = await fs.open(canonical, "r");
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) return undefined;
    if (openedStat.size > budget.limits.maxFileBytes) {
      diagnostic(budget, { code: "rule_file_bytes_limit", path: canonical, limit: budget.limits.maxFileBytes });
      return undefined;
    }
    if (budget.totalBytes + openedStat.size > budget.limits.maxTotalBytes) {
      diagnostic(budget, { code: "rule_total_bytes_limit", path: canonical, limit: budget.limits.maxTotalBytes });
      return undefined;
    }
    const bytes = Buffer.alloc(openedStat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) return undefined;
      offset += result.bytesRead;
    }
    budget.totalBytes += bytes.length;
    return bytes.toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function listRuleFiles(
  directory: string,
  containmentRoot: string | undefined,
  budget: DiscoveryBudget
): Promise<readonly string[]> {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    const canonical = await fs.realpath(directory);
    if (containmentRoot !== undefined && !isContainedPath(containmentRoot, canonical)) return [];
    const pending = [canonical];
    const files: string[] = [];
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) break;
      const childDirectories: string[] = [];
      const handle = await fs.opendir(current);
      for await (const entry of handle) {
        budget.scannedEntries += 1;
        if (budget.scannedEntries > budget.limits.maxScannedEntries) {
          diagnostic(budget, { code: "rule_scan_entry_limit", path: current, limit: budget.limits.maxScannedEntries });
          budget.blocked = true;
          return [];
        }
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) childDirectories.push(entryPath);
        else if (entry.isFile() && ruleExtensions.has(path.extname(entry.name).toLowerCase())) {
          if (!registerRuleFile(entryPath, budget)) return [];
          files.push(entryPath);
        }
      }
      pending.push(...childDirectories.sort());
    }
    return files.sort();
  } catch {
    return [];
  }
}

async function canonicalStartDirectory(projectRoot: string, startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  while (true) {
    try {
      const canonical = await fs.realpath(current);
      return isContainedPath(projectRoot, canonical) ? canonical : projectRoot;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") return projectRoot;
      const parent = path.dirname(current);
      if (parent === current) return projectRoot;
      current = parent;
    }
  }
}

function ancestorDirectories(projectRoot: string, startDir: string): readonly string[] {
  const root = projectRoot;
  let current = startDir;
  const chain: string[] = [];
  // Guard against a startDir outside the project: scanning upward from there would read rule files
  // the user never approved for this workspace.
  if (!isContainedPath(root, current)) return [root];
  while (true) {
    chain.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

async function collectFrom(
  location: ProjectLocation,
  baseDir: string,
  distance: number,
  isGlobal: boolean,
  collected: DiscoveredRule[],
  budget: DiscoveryBudget,
  containmentRoot?: string
): Promise<void> {
  const target = path.join(baseDir, location.relativePath);
  const files = location.kind === "file" ? [target] : await listRuleFiles(target, containmentRoot, budget);
  if (budget.blocked) return;
  for (const filePath of files) {
    const text = await readIfFile(filePath, containmentRoot, budget, location.kind === "file");
    if (budget.blocked) return;
    if (text === undefined) continue;
    const parsed = parseRuleFile(text);
    if (parsed.body.trim() === "") continue;
    collected.push({
      id: filePath,
      sourceId: location.id,
      filePath,
      scopeDir: baseDir,
      priority: sourcePriority[location.id],
      distance,
      isGlobal,
      frontmatter: parsed.frontmatter,
      body: parsed.body
    });
  }
}

// Most authoritative first. Distance outranks source priority deliberately and in agreement with the
// sibling engines: a rule sitting next to the edited file is more specific than a higher-priority
// source at the repository root, and specificity is what a rule author is expressing by putting the
// file there. Local always beats user-home, which always beats bundled.
export function compareRules(left: DiscoveredRule, right: DiscoveredRule): number {
  if (left.isGlobal !== right.isGlobal) return left.isGlobal ? 1 : -1;
  if (left.distance !== right.distance) return left.distance - right.distance;
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.filePath.localeCompare(right.filePath);
}

export async function discoverRules(options: DiscoveryOptions): Promise<readonly DiscoveredRule[]> {
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot));
  const startDir = await canonicalStartDirectory(projectRoot, options.startDir ?? projectRoot);
  const homeDir = options.homeDir ?? os.homedir();
  const collected: DiscoveredRule[] = [];
  const bounded = (key: keyof RuleDiscoveryLimits): number => {
    const requested = options.limits?.[key];
    return requested === undefined
      ? ruleDiscoveryLimits[key]
      : Math.min(ruleDiscoveryLimits[key], Math.max(1, Math.floor(requested)));
  };
  const budget: DiscoveryBudget = {
    limits: {
      maxFiles: bounded("maxFiles"),
      maxFileBytes: bounded("maxFileBytes"),
      maxTotalBytes: bounded("maxTotalBytes"),
      maxScannedEntries: bounded("maxScannedEntries")
    },
    onDiagnostic: options.onDiagnostic,
    filesSeen: 0,
    scannedEntries: 0,
    totalBytes: 0,
    blocked: false
  };

  const chain = ancestorDirectories(projectRoot, startDir);
  for (const [distance, directory] of chain.entries()) {
    for (const location of projectLocations) {
      await collectFrom(location, directory, distance, false, collected, budget, projectRoot);
      if (budget.blocked) return Object.freeze([]);
    }
  }

  if (homeDir !== "") {
    for (const location of userLocations) {
      await collectFrom(location, homeDir, userDistance, true, collected, budget);
      if (budget.blocked) return Object.freeze([]);
    }
  }

  if (options.bundledRulesDir !== undefined) {
    await collectFrom(
      { id: "bundled", relativePath: ".", kind: "directory" },
      options.bundledRulesDir,
      bundledDistance,
      true,
      collected,
      budget
    );
    if (budget.blocked) return Object.freeze([]);
  }

  const deduped = new Map<string, DiscoveredRule>();
  for (const rule of collected) if (!deduped.has(rule.filePath)) deduped.set(rule.filePath, rule);
  return Object.freeze([...deduped.values()].sort(compareRules));
}
