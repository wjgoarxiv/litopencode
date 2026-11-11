import { nativeManagedSkillReferences } from "./cli/managed-skill-assets.ts";
import { scientificVisualizationBanner } from "./scientific-visualization-banner.ts";
import { activationBanner, activationProbeInstruction } from "./activation-probe.ts";
import { readManagedSkillAsset, readStaticSkillBody } from "./activation-prompt-utils.ts";

const litHandoffBanner = activationBanner("lit-handoff");
export const litHandoffPromptInjection = `${litHandoffBanner}
<lit-handoff-mode>
${activationProbeInstruction("lit-handoff")}

Load the native lit-handoff skill from OpenCode first. Resolve SKILL_ROOT to its
canonical/ directory, next to that installed SKILL.md, never relative to the project
or command file. Apply
the complete adapter, original contract, and template below without abbreviation. Verify
live workspace state because an existing handoff can be stale.

# OpenCode adapter

${nativeManagedSkillReferences("lit-handoff", readStaticSkillBody("lit-handoff"))}

# Exact original contract

${readManagedSkillAsset("lit-handoff", "../../vendor/handoff/SKILL.md")}

# Resolved exact template

${readManagedSkillAsset("lit-handoff", "../../vendor/handoff/templates/HANDOFF.md")}
</lit-handoff-mode>`;

// lit-scientific-visualization moved to wjgoarxiv-skills with its vendored source; the exact routes stay and
// hand the model the same-name pointer, whose body carries the install line.
export const scientificVisualizationPromptInjection = `${scientificVisualizationBanner}
<lit-scientific-visualization-mode>
${activationProbeInstruction("lit-scientific-visualization")}

lit-scientific-visualization is no longer part of LitOpenCode. Load it with OpenCode's native skill tool: when the
user has installed the wjgoarxiv-skills copy, that is the skill that loads, so follow it. When the pointer below is
what loads, answer from it: say where the skill went, give its install line, and plot nothing.

# Installed pointer

${readStaticSkillBody("lit-scientific-visualization")}
</lit-scientific-visualization-mode>`;
