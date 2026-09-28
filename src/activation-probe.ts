export function activationDiscipline(skillId: string): string {
  switch (skillId) {
    case "lit":
    case "litwork":
    case "lit-work":
    case "workflow-loop": return "lit-loop";
    case "lit-research": return "litresearch";
    case "lit-goal":
    case "durable-litgoal": return "litgoal";
    case "lit-korean":
    case "text-naturalization":
    case "text-neutralization":
    case "korean-ai-slop-remover": return "lit-humanizer";
    default: return skillId;
  }
}

export function activationBanner(skillId: string): string {
  return `🔥 LIT IGNITED · ${activationDiscipline(skillId)} 🔥`;
}

export function activationProbe(skillId: string): string {
  return `🔥 **LIT IGNITED · ${activationDiscipline(skillId)}** 🔥`;
}

export function activationProbeInstruction(skillId: string): string {
  return `Your first reply line MUST be exactly:\n\n${activationProbe(skillId)}\n\nEmit it once, then begin the work.`;
}
