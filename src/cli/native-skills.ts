import path from "node:path";
import { litOpenCodeRuntimeSkills } from "../skills.ts";
import {
  destinationState,
  assertInstalledCanonicalOwnership,
  detectShadowedSkills,
  invalidInstalledAssets,
  nativeSkillsRoot,
  nativeSkillsRootLink,
  validateSkillSource,
  type DestinationState,
  type NativeSkillsRootLink,
  type ShadowedSkill
} from "./native-skill-integrity.ts";
import { inspectScientificVisualizationDependencies } from "./scientific-visualization-dependencies.ts";
import { inspectOfficeDependencies } from "./office-dependencies.ts";
import type { InstallReport, PackageMetadata } from "./types.ts";

export { validateManagedSkillSource } from "./native-skill-integrity.ts";
export { ensureNativeSkills } from "./native-skill-install.ts";
export type { NativeSkillsRootLink, ShadowedSkill, ShadowSkillLocation, ShadowSkillLocationId } from "./native-skill-integrity.ts";

// nativeSkillsRoot() follows the same intentional-symlink resolution install uses; if it fails,
// fall back to the unresolved path so link/shadow reporting stays best-effort instead of throwing.
async function bestEffortNativeSkillsRoot(root: string): Promise<string> {
  try {
    return await nativeSkillsRoot(root);
  } catch {
    return path.join(root, "skills");
  }
}

export async function describeNativeSkillMutation(
  root: string,
  metadata: PackageMetadata
): Promise<InstallReport["nativeSkills"]> {
  const write: string[] = [];
  const preserve: string[] = [];
  const collisions: string[] = [];
  for (const skill of litOpenCodeRuntimeSkills) {
    await validateSkillSource(metadata, skill);
    const destination = await destinationState(root, skill);
    if (destination.kind === "managed") await assertInstalledCanonicalOwnership(root, skill);
    if (destination.kind === "absent" || destination.kind === "managed") write.push(skill.id);
    else {
      preserve.push(skill.id);
      if (destination.entrypoint === undefined) collisions.push(skill.id);
    }
  }
  const link = await nativeSkillsRootLink(root);
  return {
    path: path.join(root, "skills"),
    changed: write.length > 0,
    write,
    preserve,
    collisions,
    ...(link === undefined ? {} : { link })
  };
}

export type NativeSkillInspection = {
  readonly path: string;
  readonly expected: readonly string[];
  readonly present: readonly string[];
  readonly missing: readonly string[];
  readonly managed: readonly string[];
  readonly preserved: readonly string[];
  readonly invalid: readonly string[];
  readonly invalidAssets: readonly string[];
  readonly sourceInvalid: readonly string[];
  readonly canonicalCacheFiles: readonly string[];
  readonly dependencies: {
    readonly "lit-scientific-visualization": ReturnType<typeof inspectScientificVisualizationDependencies>;
    readonly office: ReturnType<typeof inspectOfficeDependencies>;
  };
  readonly link?: NativeSkillsRootLink;
  // Other OpenCode-visible skill roots that shadow a managed skill id; warnings only, never `ok`.
  readonly shadowedSkills: readonly ShadowedSkill[];
  readonly ok: boolean;
};

export type InspectNativeSkillsOptions = {
  readonly homeDir?: string;
  readonly workDir?: string;
};

export async function inspectNativeSkills(
  root: string,
  metadata: PackageMetadata,
  options: InspectNativeSkillsOptions = {}
): Promise<NativeSkillInspection> {
  const present: string[] = [];
  const missing: string[] = [];
  const managed: string[] = [];
  const preserved: string[] = [];
  const invalid: string[] = [];
  const invalidAssets: string[] = [];
  const sourceInvalid: string[] = [];
  const canonicalCacheFiles: string[] = [];

  for (const skill of litOpenCodeRuntimeSkills) {
    let sourceOk = true;
    try {
      await validateSkillSource(metadata, skill);
    } catch (error) {
      sourceOk = false;
      sourceInvalid.push(skill.id);
      invalid.push(skill.id);
      invalidAssets.push(`${skill.id}/source: ${error instanceof Error ? error.message : String(error)}`);
    }

    let destination: DestinationState;
    try {
      destination = await destinationState(root, skill);
    } catch (error) {
      invalid.push(skill.id);
      invalidAssets.push(`${skill.id}/destination: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (destination.kind === "absent") {
      missing.push(skill.id);
      continue;
    }
    if (destination.kind === "preserved") {
      preserved.push(skill.id);
      if (destination.entrypoint === undefined) {
        missing.push(skill.id);
        invalid.push(skill.id);
        invalidAssets.push(`${skill.id}/SKILL.md`);
      } else {
        present.push(skill.id);
      }
      continue;
    }

    present.push(skill.id);
    managed.push(skill.id);
    if (!sourceOk) continue;
    const failures = await invalidInstalledAssets(path.dirname(destination.entrypoint), metadata, skill);
    if (failures.length > 0) {
      invalid.push(skill.id);
      invalidAssets.push(...failures.map((failure) => `${skill.id}/${failure}`));
    } else {
      canonicalCacheFiles.push(...(await assertInstalledCanonicalOwnership(root, skill)).map((cache) => `${skill.id}/canonical/${cache.path}`));
    }
  }

  const uniqueInvalid = [...new Set(invalid)];
  const link = await nativeSkillsRootLink(root, options.homeDir);
  const shadowedSkills = await detectShadowedSkills(
    litOpenCodeRuntimeSkills.map((skill) => skill.id),
    await bestEffortNativeSkillsRoot(root),
    options.homeDir,
    options.workDir
  );
  return {
    path: path.join(root, "skills"),
    expected: litOpenCodeRuntimeSkills.map((skill) => skill.id),
    present,
    missing,
    managed,
    preserved,
    invalid: uniqueInvalid,
    invalidAssets: [...new Set(invalidAssets)],
    sourceInvalid,
    canonicalCacheFiles,
    dependencies: { "lit-scientific-visualization": inspectScientificVisualizationDependencies(), office: inspectOfficeDependencies() },
    ...(link === undefined ? {} : { link }),
    shadowedSkills,
    ok: missing.length === 0 && uniqueInvalid.length === 0
  };
}
