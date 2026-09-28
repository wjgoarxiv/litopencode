import { activationBanner, activationProbeInstruction } from "./activation-probe.ts";
import { readFileSync } from "node:fs";
import { stripUserFacingHtmlCommentLines } from "./user-facing-markdown.ts";

export type StaticSkillPromptId =
  | "workflow-loop"
  | "durable-litgoal"
  | "lit-plan"
  | "start-work"
  | "review-work"
  | "litresearch"
  | "lit-init"
  | "lit-crucible"
  | "lit-burnoff-file"
  | "lit-fetch"
  | "refactor"
  | "lit-burnoff"
  | "lit-code"
  | "debugging"
  | "lit-commit"
  | "lsp"
  | "lsp-setup"
  | "rules"
  | "deep-interview"
  | "structural-search"
  | "browser-drive"
  | "lit-recap"
  | "lit-comprehend"
  | "lit-humanizer"
  | "lit-handoff"
  | "lit-scientific-visualization"
  | "frontend-ui-ux"
  | "visual-qa";

export const litActivationBanner = activationBanner("lit-loop");

function stripYamlFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? text : text.slice(end + "\n---\n".length);
}

export function readStaticSkillBody(skillId: StaticSkillPromptId): string {
  return stripUserFacingHtmlCommentLines(
    stripYamlFrontmatter(readFileSync(new URL(`../skills/${skillId}/SKILL.md`, import.meta.url), "utf8"))
  ).trim();
}

export function readManagedSkillAsset(
  skillId: "lit-handoff" | "lit-scientific-visualization",
  relativePath: string
): string {
  return readFileSync(new URL(`../skills/${skillId}/${relativePath}`, import.meta.url), "utf8");
}

export function skillBackedPromptInjection(modeTag: string, lead: string, skillId: StaticSkillPromptId): string {
  return `${activationBanner(skillId)}
<${modeTag}>
${activationProbeInstruction(skillId)}

${lead.trim()}

# Installed skill body

${readStaticSkillBody(skillId)}
</${modeTag}>`;
}

export function promptWithSkillBody(prompt: string, modeTag: string, skillId: StaticSkillPromptId): string {
  const closeTag = `</${modeTag}>`;
  const closeIndex = prompt.lastIndexOf(closeTag);
  if (closeIndex === -1) return prompt;
  const bodyBlock = ["", "# Installed skill body", "", readStaticSkillBody(skillId), ""].join("\n");
  return `${prompt.slice(0, closeIndex).trimEnd()}${bodyBlock}${closeTag}`;
}
