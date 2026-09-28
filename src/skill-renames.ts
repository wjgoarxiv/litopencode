import { readFileSync } from "node:fs";
import type { LitOpenCodeRuntimeSkillId } from "./skills.ts";

// One-release compatibility. Canonical catalogs contain only the keys of this map.
export type RenamedSkillId = Extract<LitOpenCodeRuntimeSkillId,
  "lit-crucible" | "lit-init" | "lit-commit" | "lit-burnoff" |
  "lit-burnoff-file" | "lit-humanizer" | "lit-fetch" | "lit-code"
>;

type RenameValue = string | readonly string[];

const renameValues = JSON.parse(
  readFileSync(new URL("../skills/skill-rename-aliases.json", import.meta.url), "utf8")
) as Readonly<Record<RenamedSkillId, RenameValue>>;

function aliasesFor(value: RenameValue): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

export const renamedSkillAliases: Readonly<Record<RenamedSkillId, readonly string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(renameValues).map(([id, value]) => [id, aliasesFor(value)])) as
    Record<RenamedSkillId, readonly string[]>
);

export const renamedSkillIds: Readonly<Record<RenamedSkillId, string>> = Object.freeze(
  Object.fromEntries(Object.entries(renamedSkillAliases).map(([id, aliases]) => [id, aliases[0]])) as
    Record<RenamedSkillId, string>
);

export const retiredManagedSkillEntrypointHashes: Readonly<Record<string, string>> = Object.freeze({
  "lit-korean": "d50edcb844eb128abd12eb233c504f38751ab858e1b0eb39456eaca221a60348"
});

export function renamedSkillId(alias: string): RenamedSkillId | undefined {
  return (Object.keys(renamedSkillAliases) as RenamedSkillId[]).find((id) => renamedSkillAliases[id].includes(alias));
}

export function skillRenameNote(id: RenamedSkillId, alias: string = renamedSkillIds[id]): string {
  return `Note: \`${alias}\` now routes to \`${id}\`; use the canonical name for new invocations.`;
}
