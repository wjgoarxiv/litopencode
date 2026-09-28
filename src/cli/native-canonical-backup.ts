import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectCanonicalTree, type RetainedCanonicalCache } from "./native-canonical-cache.ts";
import { installedCanonicalDirectory, managedSkillDefinition } from "./managed-skill-assets.ts";
import { assertInstalledCanonicalOwnership, nativeSkillsRoot, type RuntimeSkill } from "./native-skill-integrity.ts";
import { lstatIfPresent } from "./native-skill-tree.ts";

async function directoryIdentity(directory: string): Promise<string> {
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe canonical backup directory: ${directory}`);
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

async function directoryChain(...directories: string[]): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  for (const directory of directories) {
    let current = directory;
    while (!entries.has(current)) {
      entries.set(current, await directoryIdentity(current));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return entries;
}

export async function prepareCanonicalBackup(
  root: string,
  skillsRoot: string,
  skill: RuntimeSkill,
  caches: readonly RetainedCanonicalCache[]
) {
  const realRoot = await fs.realpath(root);
  const realSkillsRoot = await fs.realpath(skillsRoot);
  const parent = path.join(realRoot, ".litopencode-canonical-backups");
  const relative = path.relative(realSkillsRoot, parent);
  if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Canonical backup must be outside native skills discovery");
  }
  const initial = await directoryChain(realRoot, realSkillsRoot);
  async function assertInitial() {
    if (await fs.realpath(root) !== realRoot || await fs.realpath(await nativeSkillsRoot(root)) !== realSkillsRoot) {
      throw new Error("Canonical backup root changed; retained state must be reviewed");
    }
    for (const [directory, identity] of initial) {
      if (await directoryIdentity(directory) !== identity) throw new Error(`Canonical backup ancestor changed: ${directory}`);
    }
  }
  await assertInitial();
  try {
    await fs.mkdir(parent, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  initial.set(parent, await directoryIdentity(parent));
  await assertInitial();
  const container = path.join(parent, `${skill.id}-${randomUUID()}`);
  await fs.mkdir(container, { mode: 0o700 });
  const owned = await directoryChain(container);
  const backup = path.join(container, "skill");
  const receipt = { schemaVersion: 1, skill: skill.id, original: path.join(skillsRoot, skill.id), backup, caches };
  await fs.writeFile(path.join(container, "prepared.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });

  async function validateBoundary() {
    await assertInitial();
    for (const [directory, identity] of owned) {
      if (await directoryIdentity(directory) !== identity) throw new Error(`Canonical backup directory changed: ${directory}`);
    }
  }
  async function validateBeforeMove() {
    await validateBoundary();
    const current = await assertInstalledCanonicalOwnership(root, skill);
    if (JSON.stringify(current) !== JSON.stringify(caches)) throw new Error("Canonical cache changed before retention");
    if (await lstatIfPresent(backup) !== null) throw new Error(`Canonical backup destination already exists: ${backup}`);
    await validateBoundary();
  }
  async function validateMoved() {
    await validateBoundary();
    await directoryIdentity(backup);
    const canonical = path.join(backup, installedCanonicalDirectory);
    await directoryIdentity(canonical);
    const definition = managedSkillDefinition(skill.id);
    if (definition === undefined) throw new Error(`Missing canonical definition for ${skill.id}`);
    const current = await inspectCanonicalTree(canonical, definition.canonicalFiles);
    if (current.failures.length > 0 || JSON.stringify(current.caches) !== JSON.stringify(caches)) {
      throw new Error(`Retained canonical bytes changed; preserve backup at ${backup}`);
    }
  }
  async function complete() {
    await validateMoved();
    await fs.writeFile(path.join(container, "receipt.json"), JSON.stringify({ ...receipt, state: "retained" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return { backup, validateBoundary, validateBeforeMove, validateMoved, complete };
}
