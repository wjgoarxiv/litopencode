import fs from "node:fs/promises";
import path from "node:path";
import { findLitOpenCodeCommand, litOpenCodeCommands } from "../commands.ts";
import { renamedSkillAliases, skillRenameNote, type RenamedSkillId } from "../skill-renames.ts";
import {
  hasLitOpenCodeGeneratedFileMarker,
  litOpenCodeGeneratedFrontmatterMarker
} from "../user-facing-markdown.ts";
import type { InstallReport } from "./types.ts";
import { lstatIfPresent } from "./native-skill-tree.ts";

function commandAliasFile(root: string, id: string): string {
  return path.join(root, "command", id + ".md");
}

function commandAliasContent(command: (typeof litOpenCodeCommands)[number]): string {
  return [
    "---",
    "description: " + JSON.stringify(command.title + " - " + command.description),
    ...(command.agent === undefined ? [] : ["agent: " + command.agent]),
    litOpenCodeGeneratedFrontmatterMarker,
    "---",
    "",
    command.activationText,
    ""
  ].join("\n");
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function describeCommandAliasMutation(root: string): Promise<InstallReport["commandAliases"]> {
  const write: string[] = [];
  const preserve: string[] = [];
  for (const command of litOpenCodeCommands) {
    const filePath = commandAliasFile(root, command.id);
    const existing = await readTextIfPresent(filePath);
    if (existing === null || hasLitOpenCodeGeneratedFileMarker(existing)) {
      write.push(command.id);
    } else {
      preserve.push(command.id);
    }
  }
  return {
    path: path.join(root, "command"),
    changed: write.length > 0,
    write,
    preserve
  };
}

export async function inspectCommandAliases(root: string): Promise<{
  readonly path: string;
  readonly expected: readonly string[];
  readonly present: readonly string[];
  readonly missing: readonly string[];
  readonly managed: readonly string[];
  readonly preserved: readonly string[];
  readonly ok: boolean;
}> {
  const present: string[] = [];
  const missing: string[] = [];
  const managed: string[] = [];
  const preserved: string[] = [];
  for (const command of litOpenCodeCommands) {
    const existing = await readTextIfPresent(commandAliasFile(root, command.id));
    if (existing === null) missing.push(command.id);
    else {
      present.push(command.id);
      if (hasLitOpenCodeGeneratedFileMarker(existing)) managed.push(command.id);
      else preserved.push(command.id);
    }
  }
  return {
    path: path.join(root, "command"),
    expected: litOpenCodeCommands.map((command) => command.id),
    present,
    missing,
    managed,
    preserved,
    ok: missing.length === 0
  };
}

export async function ensureCommandAliases(root: string): Promise<void> {
  const commandDir = path.join(root, "command");
  await fs.mkdir(commandDir, { recursive: true });
  for (const command of litOpenCodeCommands) {
    const filePath = commandAliasFile(root, command.id);
    const existing = await readTextIfPresent(filePath);
    if (existing !== null && !hasLitOpenCodeGeneratedFileMarker(existing)) continue;
    await fs.writeFile(filePath, commandAliasContent(command), "utf8");
  }
  for (const id of Object.keys(renamedSkillAliases) as RenamedSkillId[]) {
    for (const alias of renamedSkillAliases[id]) {
      const filePath = commandAliasFile(root, alias);
      const stat = await lstatIfPresent(filePath);
      if (stat !== null && (stat.isSymbolicLink() || !stat.isFile())) {
        throw new Error(`Unsafe command redirect destination: ${filePath}`);
      }
      const existing = await readTextIfPresent(filePath);
      if (existing !== null && !hasLitOpenCodeGeneratedFileMarker(existing)) continue;
      const command = findLitOpenCodeCommand(id);
      if (command === undefined) throw new Error(`Missing redirect target: ${id}`);
      await fs.writeFile(filePath, [
        "---",
        `description: ${JSON.stringify(`Redirect to /${id}`)}`,
        ...(command.agent === undefined ? [] : [`agent: ${command.agent}`]),
        litOpenCodeGeneratedFrontmatterMarker,
        "---",
        "",
        `Invoke /${id} with the supplied arguments and follow its skill contract. Print this line once: ${skillRenameNote(id, alias)}`,
        ""
      ].join("\n"), "utf8");
    }
  }
}
