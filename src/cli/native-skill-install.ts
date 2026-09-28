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

export async function ensureNativeSkills(root: string, metadata: PackageMetadata): Promise<void> {
  const skillsRoot = await nativeSkillsRoot(root);
  await fs.mkdir(skillsRoot, { recursive: true });

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
}
