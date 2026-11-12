import { createHash, randomUUID } from "node:crypto";
import { prepareCanonicalBackup } from "./native-canonical-backup.ts";
import type { RetainedCanonicalCache } from "./native-canonical-cache.ts";
import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeRuntimeSkills } from "../skills.ts";
import {
  assetPathsForManagedSkill,
  installedCanonicalDirectory,
  managedSkillDefinition,
  previousManagedSkillId
} from "./managed-skill-assets.ts";
import { retiredManagedSkillEntrypointHashes } from "../skill-renames.ts";
import {
  destinationState,
  assertInstalledCanonicalOwnership,
  invalidInstalledAssets,
  nativeSkillContent,
  nativeSkillsRoot,
  sourceSkillDir,
  userOwnedSkillFiles,
  validateSkillSource,
  type RuntimeSkill
} from "./native-skill-integrity.ts";
import { assertContained, lstatIfPresent } from "./native-skill-tree.ts";
import type { PackageMetadata } from "./types.ts";

async function createStagedSkill(skillsRoot: string, metadata: PackageMetadata, skill: RuntimeSkill): Promise<string> {
  const stage = path.join(skillsRoot, `.${skill.id}.${randomUUID()}.stage`);
  await fs.mkdir(stage, { recursive: false });
  try {
    await fs.writeFile(path.join(stage, "SKILL.md"), await nativeSkillContent(metadata, skill), "utf8");
    for (const relativePath of assetPathsForManagedSkill(skill.id)) {
      const destination = path.join(stage, relativePath);
      assertContained(stage, destination, `Staged native skill ${skill.id}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(sourceSkillDir(metadata, skill.id), relativePath), destination);
    }
    const definition = managedSkillDefinition(skill.id);
    if (definition?.canonicalRoot !== undefined) {
      const canonicalRoot = path.resolve(sourceSkillDir(metadata, skill.id), definition.canonicalRoot);
      for (const asset of definition.canonicalFiles) {
        const source = path.join(canonicalRoot, asset.path);
        const destination = path.join(stage, installedCanonicalDirectory, asset.path);
        assertContained(canonicalRoot, source, `Canonical source ${skill.id}`);
        assertContained(stage, destination, `Staged canonical ${skill.id}`);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      }
    }
    const failures = await invalidInstalledAssets(stage, metadata, skill);
    if (failures.length > 0) throw new Error(`Staged native skill ${skill.id} failed verification: ${failures.join(", ")}`);
    return stage;
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function swapStagedSkill(
  root: string, skillsRoot: string, target: string, stage: string, skill: RuntimeSkill,
  caches: readonly RetainedCanonicalCache[]
): Promise<void> {
  const id = skill.id;
  if (await lstatIfPresent(target) === null) {
    await fs.rename(stage, target);
    return;
  }

  const retained = caches.length === 0 ? undefined : await prepareCanonicalBackup(root, skillsRoot, skill, caches);
  const backup = retained?.backup ?? path.join(skillsRoot, `.${id}.${randomUUID()}.backup`);
  await retained?.validateBeforeMove();
  await fs.rename(target, backup);
  try {
    await retained?.validateMoved();
    if (retained !== undefined && await lstatIfPresent(target) !== null) throw new Error(`Native skill target appeared during replacement: ${target}`);
    await fs.rename(stage, target);
    await retained?.complete();
  } catch (error) {
    try {
      await retained?.validateMoved();
      if (retained !== undefined && await lstatIfPresent(target) !== null) throw new Error(`Unsafe rollback target already exists: ${target}`);
      await fs.rename(backup, target);
    } catch (rollbackError) {
      throw new Error(retained === undefined
        ? `Atomic native skill swap failed for ${id}, and rollback failed; previous tree remains at ${backup}: ${String(error)}; rollback: ${String(rollbackError)}`
        : `Atomic native skill swap failed for ${id}; rollback unsafe or failed, state unknown; previous tree last recorded at ${backup}: ${String(error)}; rollback: ${String(rollbackError)}`
      );
    }
    throw new Error(`Atomic native skill swap failed for ${id}; previous tree was restored: ${String(error)}`);
  }
  if (retained === undefined) await fs.rm(backup, { recursive: true, force: true });
}

async function stagedCleanup(stage: string): Promise<() => Promise<void>> {
  const identity = await fs.lstat(stage, { bigint: true });
  const real = await fs.realpath(stage);
  return async () => {
    if (await lstatIfPresent(stage) === null) return;
    const current = await fs.lstat(stage, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev ||
      current.ino !== identity.ino || current.birthtimeNs !== identity.birthtimeNs || await fs.realpath(stage) !== real) {
      throw new Error(`Staged cleanup refused changed identity or ancestry; preserve ${stage}`);
    }
    await fs.rm(stage, { recursive: true, force: true });
  };
}

async function retirePreviousSkill(root: string, skillsRoot: string, skill: RuntimeSkill): Promise<void> {
  const previousId = previousManagedSkillId(skill.id);
  if (previousId === undefined) return;
  const previousRoot = path.join(skillsRoot, previousId);
  assertContained(skillsRoot, previousRoot, `Previous native skill ${skill.id}`);
  const previous = await destinationState(root, { id: previousId });
  if (previous.kind === "absent") return;

  const expectedHash = retiredManagedSkillEntrypointHashes[previousId];
  if (previous.kind === "managed" && expectedHash === undefined) {
    await fs.rm(previousRoot, { recursive: true });
    return;
  }
  if (previous.kind === "managed" && expectedHash !== undefined) {
    const entries = await fs.readdir(previousRoot);
    const content = entries.length === 1 && entries[0] === "SKILL.md"
      ? await fs.readFile(previous.entrypoint, "utf8")
      : undefined;
    const actualHash = content === undefined ? undefined : createHash("sha256").update(content).digest("hex");
    if (actualHash === expectedHash) {
      await fs.rm(previousRoot, { recursive: true });
      return;
    }
  }
  if (expectedHash !== undefined) {
    process.stderr.write(`LitOpenCode: kept previous skill ${previousId}; it is modified or user-owned. Review ${previousRoot} before removal.\n`);
  }
}

export const skillBackupsDirectoryName = ".litopencode-skill-backups";

export type NativeSkillBackup = {
  /** The dated folder that holds the copies, outside the skills root; absent when nothing needed copying. */
  readonly directory?: string;
  /** `<skill>/<path>` for each copied file. */
  readonly files: readonly string[];
};

function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// One dated folder per install run; a second run on the same day gets the next free suffix.
async function createBackupDirectory(root: string): Promise<string> {
  const parent = path.join(path.resolve(root), skillBackupsDirectoryName);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const date = localDate(new Date());
  for (let attempt = 1; ; attempt += 1) {
    const candidate = path.join(parent, attempt === 1 ? date : `${date}-${attempt}`);
    try {
      await fs.mkdir(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
}

async function copyUserFiles(skillRoot: string, backup: string, id: string, files: readonly string[]): Promise<void> {
  const target = path.join(backup, id);
  for (const relativePath of files) {
    const source = path.join(skillRoot, relativePath);
    const destination = path.join(target, relativePath);
    assertContained(skillRoot, source, `User file in ${id}`);
    assertContained(target, destination, `Backup of ${id}`);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    if (!(await fs.readFile(destination)).equals(await fs.readFile(source))) {
      throw new Error(`Backup of ${id}/${relativePath} does not match the original; nothing was replaced`);
    }
  }
}

export async function ensureNativeSkills(root: string, metadata: PackageMetadata): Promise<NativeSkillBackup> {
  const skillsRoot = await nativeSkillsRoot(root);
  await fs.mkdir(skillsRoot, { recursive: true });
  let backupDirectory: string | undefined;
  const backedUp: string[] = [];

  for (const skill of litOpenCodeRuntimeSkills) {
    await validateSkillSource(metadata, skill);
    const destination = await destinationState(root, skill);
    if (destination.kind === "preserved") continue;
    await assertInstalledCanonicalOwnership(root, skill);

    const stage = await createStagedSkill(skillsRoot, metadata, skill);
    const removeStage = await stagedCleanup(stage);
    try {
      const current = await destinationState(root, skill);
      if (current.kind === "preserved") {
        await removeStage();
        continue;
      }
      const caches = await assertInstalledCanonicalOwnership(root, skill);
      const userFiles = await userOwnedSkillFiles(root, metadata, skill);
      if (userFiles.length > 0) {
        backupDirectory ??= await createBackupDirectory(root);
        await copyUserFiles(path.join(skillsRoot, skill.id), backupDirectory, skill.id, userFiles);
        backedUp.push(...userFiles.map((file) => `${skill.id}/${file}`));
      }
      await swapStagedSkill(root, skillsRoot, path.join(skillsRoot, skill.id), stage, skill, caches);
      await retirePreviousSkill(root, skillsRoot, skill);
    } catch (error) {
      try {
        await removeStage();
      } catch (cleanupError) {
        throw new Error(`${String(error)}; ${String(cleanupError)}`);
      }
      throw error;
    }
  }
  return backupDirectory === undefined ? { files: [] } : { directory: backupDirectory, files: backedUp };
}
