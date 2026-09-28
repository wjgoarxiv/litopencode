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

export const scientificVisualizationPromptInjection = `${scientificVisualizationBanner}
<lit-scientific-visualization-mode>
${activationProbeInstruction("lit-scientific-visualization")}

Load the native lit-scientific-visualization skill from OpenCode first. Resolve
SKILL_ROOT to its canonical/ directory, next to that installed SKILL.md, never relative
to the project or command file. Read related assets, scripts, and references from that root. Do not install
Python packages silently; report executable capability as READY or DEGRADED.

# OpenCode adapter

${nativeManagedSkillReferences("lit-scientific-visualization", readStaticSkillBody("lit-scientific-visualization"))}

# Exact original contract

${readManagedSkillAsset("lit-scientific-visualization", "../../vendor/scientific-visualization/SKILL.md")}
</lit-scientific-visualization-mode>`;
