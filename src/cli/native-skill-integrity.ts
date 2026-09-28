import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { litOpenCodeRuntimeSkills } from "../skills.ts";
import {
  hasLitOpenCodeGeneratedFileMarker,
  litOpenCodeGeneratedFrontmatterMarker,
  stripUserFacingHtmlCommentLines
} from "../user-facing-markdown.ts";
import {
  expectedManagedSkillFiles,
  expectedInstalledSkillFiles,
  installedCanonicalDirectory,
  nativeManagedSkillReferences,
  isRecursivelyManagedSkill,
  managedVendorAssets,
  managedSkillDefinition,
  managedSkillDiscoveryDescription,
  type ManagedSkillId
} from "./managed-skill-assets.ts";
import {
  assertContained,
  assertPathComponentsSafe,
  exactTreeFailures,
  inventoryTree,
  lstatIfPresent,
  resolveSafeDirectory
} from "./native-skill-tree.ts";
import { inspectCanonicalTree, type RetainedCanonicalCache } from "./native-canonical-cache.ts";
import type { PackageMetadata } from "./types.ts";

export type RuntimeSkill = (typeof litOpenCodeRuntimeSkills)[number];

export type DestinationState =
  | { readonly kind: "absent" }
  | { readonly kind: "managed"; readonly entrypoint: string }
  | { readonly kind: "preserved"; readonly entrypoint?: string; readonly reason: string };

export async function nativeSkillsRoot(root: string): Promise<string> {
  return resolveSafeDirectory(root, path.join(root, "skills"), "Native skills destination");
}

export type NativeSkillsRootLink = {
  // The host-facing <root>/skills path, before following the link.
  readonly path: string;
  // The realpath resolveSafeDirectory already follows managed installs through.
  readonly target: string;
  // Set only when `target` sits inside a git work tree, so managed skills would land in it.
  readonly gitRepositoryRoot?: string;
};

// Walks upward from `startDir` looking for a `.git` entry (directory or the gitdir-pointer file a
// worktree/submodule uses), stopping once it reaches `homeDir` or the filesystem root so an
// unrelated ancestor repository is never reported as the destination.
async function gitRepositoryRootFor(startDir: string, homeDir: string): Promise<string | undefined> {
  const home = path.resolve(homeDir);
  const fsRoot = path.parse(startDir).root;
  let current = path.resolve(startDir);
  while (true) {
    if ((await lstatIfPresent(path.join(current, ".git"))) !== null) return current;
    if (current === home || current === fsRoot) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// Reports the same symlink LitOpenCode intentionally follows for install (resolveSafeDirectory),
// so users can see where their managed skills actually landed and whether that is a git work tree.
export async function nativeSkillsRootLink(
  root: string,
  homeDir: string = os.homedir()
): Promise<NativeSkillsRootLink | undefined> {
  const skillsPath = path.join(path.resolve(root), "skills");
  const stat = await lstatIfPresent(skillsPath);
  if (stat === null || !stat.isSymbolicLink()) return undefined;
  const target = await fs.realpath(skillsPath);
  const gitRepositoryRoot = await gitRepositoryRootFor(target, homeDir);
  return { path: skillsPath, target, ...(gitRepositoryRoot === undefined ? {} : { gitRepositoryRoot }) };
}

export type ShadowSkillLocationId = "user-agents" | "user-claude" | "project-opencode" | "project-claude" | "project-agents";

export type ShadowSkillLocation = {
  readonly id: ShadowSkillLocationId;
  readonly root: string;
};

export type ShadowedSkill = {
  readonly id: string;
  readonly locations: readonly ShadowSkillLocation[];
};

function shadowSkillCandidateRoots(homeDir: string, workDir: string): readonly ShadowSkillLocation[] {
  return [
    { id: "user-agents", root: path.join(homeDir, ".agents", "skills") },
    { id: "user-claude", root: path.join(homeDir, ".claude", "skills") },
    { id: "project-opencode", root: path.join(workDir, ".opencode", "skills") },
    { id: "project-claude", root: path.join(workDir, ".claude", "skills") },
    { id: "project-agents", root: path.join(workDir, ".agents", "skills") }
  ];
}

async function statIfPresent(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

async function realpathOrResolved(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

// OpenCode also reads skills from these other, unmanaged roots; a same-named skill there can be
// loaded instead of (or alongside) LitOpenCode's managed copy. This is informational only: it never
// changes `ok`, because LitOpenCode does not own those directories.
export async function detectShadowedSkills(
  skillIds: readonly string[],
  managedSkillsRoot: string,
  homeDir: string = os.homedir(),
  workDir: string = process.cwd()
): Promise<readonly ShadowedSkill[]> {
  const managedRealpath = await realpathOrResolved(managedSkillsRoot);
  const candidates = shadowSkillCandidateRoots(homeDir, workDir);
  const shadowed: ShadowedSkill[] = [];
  for (const id of skillIds) {
    const locations: ShadowSkillLocation[] = [];
    for (const candidate of candidates) {
      const entrypoint = path.join(candidate.root, id, "SKILL.md");
      const stat = await statIfPresent(entrypoint);
      if (stat === null || !stat.isFile()) continue;
      if ((await realpathOrResolved(candidate.root)) === managedRealpath) continue;
      locations.push(candidate);
    }
    if (locations.length > 0) shadowed.push({ id, locations });
  }
  return shadowed;
}

export function sourceSkillDir(metadata: PackageMetadata, id: string): string {
  return path.join(metadata.packageRoot, "skills", id);
}

function sourceSkillFile(metadata: PackageMetadata, id: string): string {
  return path.join(sourceSkillDir(metadata, id), "SKILL.md");
}

function stripYamlFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? text : text.slice(end + "\n---\n".length);
}

export async function nativeSkillContent(metadata: PackageMetadata, skill: RuntimeSkill): Promise<string> {
  const source = await fs.readFile(sourceSkillFile(metadata, skill.id), "utf8");
  const body = nativeManagedSkillReferences(skill.id, stripUserFacingHtmlCommentLines(stripYamlFrontmatter(source))).trimStart();
  const description = skill.summary + " " + managedSkillDiscoveryDescription(skill.id);
  return [
    "---",
    "name: " + skill.id,
    "description: |-",
    ...description.split("\n").map((line) => "  " + line),
    "metadata:",
    `  ${litOpenCodeGeneratedFrontmatterMarker.replace(": true", ': "true"')}`,
    ...(skill.id === "lit-diagram-drawer" ? ["  reader_projection: shared_rule"] : []),
    "---",
    "",
    body.trimEnd(),
    ""
  ].join("\n");
}

export async function validateManagedSkillSource(metadata: PackageMetadata, id: ManagedSkillId): Promise<void> {
  const skillRoot = sourceSkillDir(metadata, id);
  await assertPathComponentsSafe(metadata.packageRoot, skillRoot, `Managed source ${id}`);
  const stat = await lstatIfPresent(skillRoot);
  if (stat === null || !stat.isDirectory()) throw new Error(`Managed source ${id} is not a directory: ${skillRoot}`);

  const definition = managedSkillDefinition(id);
  if (definition === undefined) throw new Error(`Managed source manifest is missing ${id}`);

  const failures = exactTreeFailures(await inventoryTree(skillRoot), expectedManagedSkillFiles(id));
  if (failures.length > 0) throw new Error(`Managed source ${id} has an altered file set: ${failures.join(", ")}`);

  const canonicalRoot = definition.canonicalRoot === undefined
    ? skillRoot
    : path.resolve(skillRoot, definition.canonicalRoot);
  await assertPathComponentsSafe(metadata.packageRoot, canonicalRoot, `Managed source ${id} canonical root`);
  const canonicalStat = await lstatIfPresent(canonicalRoot);
  if (canonicalStat === null || !canonicalStat.isDirectory()) {
    throw new Error(`Managed source ${id} canonical root is not a directory: ${canonicalRoot}`);
  }
  if (definition.canonicalRoot !== undefined) {
    const canonicalFailures = exactTreeFailures(
      await inventoryTree(canonicalRoot),
      definition.canonicalFiles.map((asset) => asset.path)
    );
    if (canonicalFailures.length > 0) {
      throw new Error(`Managed source ${id} canonical tree has an altered file set: ${canonicalFailures.join(", ")}`);
    }
  }
  for (const asset of definition.canonicalFiles) {
    const actual = createHash("sha256").update(await fs.readFile(path.join(canonicalRoot, asset.path))).digest("hex");
    if (actual !== asset.sha256) {
      const sourceLabel = definition.canonicalRoot === undefined ? asset.path : `${definition.canonicalRoot}/${asset.path}`;
      throw new Error(`Managed source ${id}/${sourceLabel} failed SHA-256: expected ${asset.sha256}, got ${actual}`);
    }
  }
  for (const asset of managedVendorAssets()) {
    const vendorPath = path.join(metadata.packageRoot, "vendor", asset.path);
    await assertPathComponentsSafe(metadata.packageRoot, vendorPath, `Managed vendor ${asset.path}`);
    const actual = createHash("sha256").update(await fs.readFile(vendorPath)).digest("hex");
    if (actual !== asset.sha256) {
      throw new Error(`Managed vendor/${asset.path} failed SHA-256: expected ${asset.sha256}, got ${actual}`);
    }
  }
}

export async function validateSkillSource(metadata: PackageMetadata, skill: RuntimeSkill): Promise<void> {
  const skillRoot = sourceSkillDir(metadata, skill.id);
  await assertPathComponentsSafe(metadata.packageRoot, sourceSkillFile(metadata, skill.id), `Skill source ${skill.id}`);
  if (isRecursivelyManagedSkill(skill.id)) {
    await validateManagedSkillSource(metadata, skill.id);
    return;
  }
  const stat = await lstatIfPresent(sourceSkillFile(metadata, skill.id));
  if (stat === null || !stat.isFile()) throw new Error(`Skill source entrypoint is missing: ${sourceSkillFile(metadata, skill.id)}`);
  const rootStat = await lstatIfPresent(skillRoot);
  if (rootStat === null || !rootStat.isDirectory()) throw new Error(`Skill source root is invalid: ${skillRoot}`);
}

export async function destinationState(root: string, skill: { readonly id: string }): Promise<DestinationState> {
  const skillsRoot = await nativeSkillsRoot(root);
  const skillRoot = path.join(skillsRoot, skill.id);
  assertContained(skillsRoot, skillRoot, `Native skill ${skill.id}`);

  const rootStat = await lstatIfPresent(skillRoot);
  if (rootStat === null) return { kind: "absent" };
  if (rootStat.isSymbolicLink()) throw new Error(`Native skill ${skill.id} destination is a symbolic link: ${skillRoot}`);
  if (!rootStat.isDirectory()) return { kind: "preserved", reason: "skill root is not a directory" };

  const entrypoint = path.join(skillRoot, "SKILL.md");
  const entryStat = await lstatIfPresent(entrypoint);
  if (entryStat === null) return { kind: "preserved", reason: "pre-existing directory has no managed entrypoint" };
  if (entryStat.isSymbolicLink()) throw new Error(`Native skill ${skill.id} entrypoint is a symbolic link: ${entrypoint}`);
  if (!entryStat.isFile()) return { kind: "preserved", reason: "entrypoint is not a regular file" };

  if (!hasLitOpenCodeGeneratedFileMarker(await fs.readFile(entrypoint, "utf8"))) {
    return { kind: "preserved", entrypoint, reason: "entrypoint is user-owned" };
  }
  const inventory = await inventoryTree(skillRoot);
  if (inventory.unsafe.length > 0) {
    throw new Error(`Native skill ${skill.id} destination contains a symbolic link or special file: ${inventory.unsafe.join(", ")}`);
  }
  return { kind: "managed", entrypoint };
}

export async function invalidInstalledAssets(
  skillRoot: string,
  metadata: PackageMetadata,
  skill: RuntimeSkill
): Promise<string[]> {
  const inventory = await inventoryTree(skillRoot);
  if (inventory.unsafe.length > 0) return exactTreeFailures(inventory, expectedInstalledSkillFiles(skill.id));
  const definition = managedSkillDefinition(skill.id);
  const canonical = definition?.canonicalRoot === undefined ? undefined : await inspectCanonicalTree(
    path.join(skillRoot, installedCanonicalDirectory), definition.canonicalFiles
  ).catch(() => ({ failures: [installedCanonicalDirectory], caches: [] }));
  const caches = canonical?.failures.length === 0 ? canonical.caches : [];
  const failures = exactTreeFailures(inventory, [
    ...expectedInstalledSkillFiles(skill.id),
    ...caches.map((cache) => `${installedCanonicalDirectory}/${cache.path}`)
  ]);
  if (canonical !== undefined) failures.push(...canonical.failures.map((file) => `${installedCanonicalDirectory}/${file}`));
  const expectedEntry = Buffer.from(await nativeSkillContent(metadata, skill));
  const installedEntry = await fs.readFile(path.join(skillRoot, "SKILL.md"));
  if (!installedEntry.equals(expectedEntry)) failures.push("SKILL.md");

  if (definition !== undefined) {
    for (const asset of definition.canonicalFiles) {
      const relativePath = definition.canonicalRoot === undefined
        ? asset.path : `${installedCanonicalDirectory}/${asset.path}`;
      const installed = await fs.readFile(path.join(skillRoot, relativePath)).catch(() => null);
      const actual = installed === null ? null : createHash("sha256").update(installed).digest("hex");
      if (actual !== asset.sha256) failures.push(relativePath);
    }
    for (const relativePath of definition.distributionFiles.filter((candidate) => candidate !== "SKILL.md")) {
      const expected = await fs.readFile(path.join(sourceSkillDir(metadata, skill.id), relativePath));
      const installed = await fs.readFile(path.join(skillRoot, relativePath)).catch(() => null);
      if (installed === null || !installed.equals(expected)) failures.push(relativePath);
    }
  }
  return [...new Set(failures)].sort();
}

export async function assertInstalledCanonicalOwnership(root: string, skill: RuntimeSkill): Promise<RetainedCanonicalCache[]> {
  const definition = managedSkillDefinition(skill.id);
  if (definition?.canonicalRoot === undefined) return [];
  const skillRoot = path.join(await nativeSkillsRoot(root), skill.id);
  const canonicalRoot = path.join(skillRoot, installedCanonicalDirectory);
  await assertPathComponentsSafe(skillRoot, canonicalRoot, `Native canonical ${skill.id}`);
  const stat = await lstatIfPresent(canonicalRoot);
  // No subtree is the previously shipped flat wrapper, so it can gain its missing closure.
  if (stat === null) return [];
  if (!stat.isDirectory()) throw new Error(`Native canonical ${skill.id} is not an owned directory`);
  const { failures, caches } = await inspectCanonicalTree(canonicalRoot, definition.canonicalFiles);
  if (failures.length > 0) {
    throw new Error(`Native canonical ${skill.id} contains modified, missing, foreign, or unsafe files; preserve it before retrying: ${failures.join(", ")}`);
  }
  return caches;
}
