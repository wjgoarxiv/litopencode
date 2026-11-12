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

// OpenCode keeps one skill per name, so the copy replaces the pointer folder rather than sitting beside it.
export function movedSkillInstallLine(id: MovedSkillId): string {
  return `cp -R "${wjgoarxivSkillsClonePlaceholder}/variants/litopencode/${id}" ~/.config/opencode/skills/${id}`;
}

export function movedSkillRouteContext(ids: readonly MovedSkillId[], deliverable: string): string {
  const names = ids.join(" and ");
  const lines = ids.map((id) => `${id}: rm -r ~/.config/opencode/skills/${id}, then ${movedSkillInstallLine(id)}`).join("; ");
  return `
After the workspace check, use OpenCode's native skill tool to load ${names} before making the requested ${deliverable}. ${ids.length > 1 ? "These skills are now LitFamily extensions" : "This skill is now a LitFamily extension"}, kept in wjgoarxiv-skills. If the installed collection copy loads, follow it. If the LitOpenCode pointer loads, reply with what it says, where the skill went and how to install it (${lines}), then stop and make nothing in its place.
`;
}
