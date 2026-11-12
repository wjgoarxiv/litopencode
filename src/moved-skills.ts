// Content skills that left LitOpenCode for the separate wjgoarxiv-skills collection. Each id stays installed as a
// same-name pointer, so a route that names the skill still loads something: the user's installed collection copy
// when present (it replaces the pointer folder), otherwise the pointer with its install line.
export const movedSkillFamilies = Object.freeze({
  "lit-pptx": "decks",
  "lit-docx": "documents",
  "lit-diagram-drawer": "figures",
  "lit-schematic": "figures",
  "lit-scientific-visualization": "figures",
  "frontend-ui-ux": "design",
  "visual-qa": "design",
  "lit-typographic-motion": "video-covers",
  "readme-studio": "video-covers"
} as const);

export type MovedSkillId = keyof typeof movedSkillFamilies;

export const wjgoarxivSkillsClonePlaceholder = "<path to your wjgoarxiv-skills clone>";

const skillsDir = "~/.config/opencode/skills";
// The dated backup folder sits beside skills/, where neither OpenCode 1 nor OpenCode 2 looks for a SKILL.md, so a
// moved-aside pointer or older copy never loads as a second skill.
const backupsDir = "~/.config/opencode/extension-backups";

// Read only: prints each same-name folder OpenCode would load, the target first.
export function movedSkillPreflightLine(id: string): string {
  return `ls -d ${skillsDir}/${id} ~/.agents/skills/${id} ~/.claude/skills/${id} 2>/dev/null`;
}

// Moves the folder whole into a dated backup, only when it exists. Nothing is deleted. Also the remove line.
export function movedSkillMoveAsideLine(id: string): string {
  return `d=${backupsDir}/$(date +%Y%m%d-%H%M%S); [ ! -e ${skillsDir}/${id} ] || { mkdir -p "$d" && mv ${skillsDir}/${id} "$d/"; }`;
}

// OpenCode keeps one skill per name, so the copy goes where the pointer was, into a folder the line above emptied.
// mkdir -p covers a home where LitOpenCode was never installed and skills/ does not exist yet.
export function movedSkillInstallLine(id: string): string {
  return `mkdir -p ${skillsDir} && cp -R "${wjgoarxivSkillsClonePlaceholder}/variants/litopencode/${id}" ${skillsDir}/${id}`;
}

// A dot-file inside the copy: OpenCode reads only SKILL.md there, and the LitOpenCode installer ignores the folder.
export function movedSkillReceiptLine(id: string): string {
  return `printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\\n' ${id} "${wjgoarxivSkillsClonePlaceholder}/variants/litopencode/${id}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${skillsDir}/${id}/.litfamily-extension.json`;
}

export function movedSkillInstallSequence(id: string): string[] {
  return [movedSkillPreflightLine(id), movedSkillMoveAsideLine(id), movedSkillInstallLine(id), movedSkillReceiptLine(id)];
}

export function movedSkillRouteContext(ids: readonly MovedSkillId[], deliverable: string): string {
  const names = ids.join(" and ");
  const lines = ids.map((id) => `${id}: ${movedSkillMoveAsideLine(id)}, then ${movedSkillInstallLine(id)}`).join("; ");
  return `
After the workspace check, use OpenCode's native skill tool to load ${names} before making the requested ${deliverable}. ${ids.length > 1 ? "These skills are now LitFamily extensions" : "This skill is now a LitFamily extension"}, kept in wjgoarxiv-skills. If the installed collection copy loads, follow it. If the LitOpenCode pointer loads, reply with what it says, where the skill went and how to install it (\`litopencode extensions install ${ids.join(" ")}\`, then again with --yes; by hand, ${lines}; the pointer adds a check line before and a receipt line after), then stop and make nothing in its place.
`;
}
