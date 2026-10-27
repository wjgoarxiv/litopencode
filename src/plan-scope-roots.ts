import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SemanticAuthorityAction } from "./bounded-authority.ts";

// A plan names the folders outside the project it needs with `Scope roots: <path> (<actions>)` lines.
// Saving refuses a plan whose todos reach an outside folder no such line covers, and typed start-work
// grants the parsed lines up front, so the run never pauses to ask for a folder the plan already named.

export type ScopeRoot = { readonly root: string; readonly actions: readonly SemanticAuthorityAction[] };
export type UncoveredScopePath =
  | { readonly path: string; readonly line: string }
  | { readonly path: string; readonly problem: string };

const scopeLine = /^Scope roots?:[ \t]*(\S+)[ \t]*\(([^()\r\n]+)\)[ \t]*$/u;
const semanticActions = new Set<string>(["read", "write", "execute"]);
// Two or more absolute segments; a lone `/` or a relative path is not a folder the work reaches.
const absolutePath = /(?<![\w.~/-])\/[\w.@+%,=~-]+(?:\/[\w.@+%,=~-]+)+\/?/gu;

function linesOutsideFences(text: string): string[] {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/u)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      continue;
    }
    if (fence === undefined) kept.push(line);
  }
  return kept;
}

/** Real path of the deepest existing ancestor, with the missing tail appended unchanged. */
function realish(target: string): string {
  const missing: string[] = [];
  for (let at = path.resolve(target); ; at = path.dirname(at)) {
    try {
      return path.join(realpathSync(at), ...missing.reverse());
    } catch {
      if (path.dirname(at) === at) return path.resolve(target);
      missing.push(path.basename(at));
    }
  }
}

function nearestDirectory(target: string): string {
  for (let at = path.resolve(target); ; at = path.dirname(at)) {
    try {
      if (statSync(at).isDirectory()) return realish(at);
    } catch {
      // Not created yet; try the parent.
    }
    if (path.dirname(at) === at) return at;
  }
}

/** The filesystem root, a top-level folder or the home folder itself is too broad to grant. */
function tooBroad(directory: string): boolean {
  const parent = path.dirname(directory);
  return parent === directory || path.dirname(parent) === parent || directory === realish(os.homedir());
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * `Scope roots:` lines outside code fences, with paths resolved against the project. A line naming a broad
 * folder, or any action other than read, write and execute, grants nothing.
 */
export function parseScopeRoots(planText: string, projectRoot: string): ScopeRoot[] {
  const roots: ScopeRoot[] = [];
  for (const line of linesOutsideFences(planText)) {
    const match = scopeLine.exec(line.trim());
    if (match === null) continue;
    const actions = match[2].split(",").map((action) => action.trim().toLowerCase());
    if (actions.length === 0 || !actions.every((action) => semanticActions.has(action))) continue;
    const root = path.resolve(projectRoot, match[1]);
    if (tooBroad(realish(root))) continue;
    roots.push({ root, actions: [...new Set(actions)] as SemanticAuthorityAction[] });
  }
  return roots;
}

/** Absolute paths of a todo line; a code span holding a command (it has a space) is data, not a reach. */
function pathMentions(line: string): string[] {
  const spansAsText = line.replace(/`([^`]*)`/gu, (_, span: string) => (/\s/u.test(span.trim()) ? " " : ` ${span.trim()} `));
  return (spansAsText.match(absolutePath) ?? []).map((mention) => mention.replace(/[.,:;)]+$/u, ""));
}

/**
 * Each outside folder the plan's todo section reaches that neither the project nor a `Scope roots:` line
 * covers, once per folder: with the exact line to paste, or with a problem when only a broad folder exists.
 */
export function uncoveredScopePaths(planText: string, projectRoot: string): UncoveredScopePath[] {
  const project = realish(projectRoot);
  const covered = [project, ...parseScopeRoots(planText, project).map((scope) => realish(scope.root))];
  const found = new Map<string, UncoveredScopePath>();
  let inTodos = false;
  for (const line of linesOutsideFences(planText)) {
    const heading = /^#{1,2}\s+(.+?)\s*$/u.exec(line)?.[1];
    if (heading !== undefined) inTodos = /^todos\b/iu.test(heading);
    if (!inTodos) continue;
    for (const mention of pathMentions(line)) {
      const real = realish(mention);
      if (covered.some((root) => within(root, real))) continue;
      const directory = nearestDirectory(mention);
      if (found.has(directory)) continue;
      found.set(directory, tooBroad(directory)
        ? { path: mention, problem: `${mention} is outside the project; name a narrower existing folder on a Scope roots line.` }
        : { path: mention, line: `Scope roots: ${directory} (read)` });
    }
  }
  return [...found.values()];
}

export function describeUncoveredScopePaths(entries: readonly UncoveredScopePath[]): string {
  return entries.map((entry) => ("line" in entry
    ? `${entry.path} is outside the project and no Scope roots line covers it; add this line to the plan: ${entry.line}`
    : entry.problem)).join(" ");
}
