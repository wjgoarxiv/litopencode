// The skill plan of a `lit <prompt>` message. The routing cascade in activation-routing.ts still picks ONE
// mode, first match wins, exactly as before; this module turns the other content routes the same prompt
// matched into companions (cascade order, no duplicates, three skills at most), adds lit-crucible when the ask
// is a large or risky design, and writes the block the model reads: confirm or drop each companion, add at
// most one from a short catalog of what is installed here, state the plan, and load each skill with OpenCode's
// native skill tool when its part starts. `lit +viz +ui <task>` names the plan outright.
//
// A moved skill (the nine LitFamily extensions in wjgoarxiv-skills) is offered only when its extension copy is
// installed for this OpenCode, which the extension receipt in the skills folder proves; otherwise the plan says
// once how to install it. A read-only primary never gains a companion that writes.
import fs from "node:fs";
import path from "node:path";
import { movedSkillFamilies, type MovedSkillId } from "./moved-skills.ts";

export const skillPlanCap = 3;

/** `lit +<alias>` names: short words a user can type without looking anything up. */
export const skillPlanAliases: Readonly<Record<string, string>> = Object.freeze({
  viz: "lit-scientific-visualization",
  plot: "lit-scientific-visualization",
  ui: "frontend-ui-ux",
  design: "frontend-ui-ux",
  qa: "visual-qa",
  crucible: "lit-crucible",
  plan: "lit-plan",
  research: "litresearch",
  review: "review-work",
  debug: "debugging",
  deck: "lit-pptx",
  slides: "lit-pptx",
  pptx: "lit-pptx",
  doc: "lit-docx",
  docx: "lit-docx",
  diagram: "lit-diagram-drawer",
  schematic: "lit-schematic",
  motion: "lit-typographic-motion",
  video: "lit-typographic-motion",
  readme: "readme-studio",
  ast: "structural-search",
  refactor: "refactor",
  brainstorm: "lit-brainstorm",
  ultra: "ultra-brainstorm",
  humanize: "lit-humanizer",
  commit: "lit-commit"
});

/** One "use when" line per skill the catalog may offer. Moved skills appear only when installed. */
export const skillPlanCatalog: Readonly<Record<string, string>> = Object.freeze({
  "lit-plan": "a decision-complete plan before code",
  "lit-crucible": "pressure-test a large or risky design before planning",
  "lit-brainstorm": "options for an open question, scored to a short list",
  "ultra-brainstorm": "hundreds of cheap idea lanes, then a judged top list",
  litresearch: "prior work and primary sources, with references",
  "review-work": "findings-first review of a diff or branch",
  debugging: "reproduce, localize and fix a failure",
  refactor: "behaviour-preserving restructure",
  "structural-search": "syntax-shaped search or codemod",
  "lit-humanizer": "rewrite prose in the writer's own voice",
  "lit-commit": "commits and git history work",
  "browser-drive": "act in a real browser page",
  "lit-pptx": "a finished .pptx deck",
  "lit-docx": "a finished .docx document",
  "lit-diagram-drawer": "a conceptual diagram (architecture, flow, timeline)",
  "lit-schematic": "a physical schematic (P&ID, PFD, apparatus, cutaway)",
  "lit-scientific-visualization": "a publication figure of measured data",
  "frontend-ui-ux": "build or restyle an interface",
  "visual-qa": "check a built interface at several sizes",
  "lit-typographic-motion": "a short kinetic-type film or README cover loop",
  "readme-studio": "a factual README with an inspected cover"
});

/** Skills that only read. A plan led by a read-only primary keeps only companions from this set. */
export const readOnlySkills: ReadonlySet<string> = new Set([
  "lit-adhd",
  "review-work",
  "litresearch",
  "lit-brainstorm",
  "ultra-brainstorm",
  "lit-crucible"
]);
const readOnlyPrimaries: ReadonlySet<string> = new Set(["lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm"]);

const extensionReceipt = ".litfamily-extension.json";

const isMoved = (id: string): id is MovedSkillId => Object.hasOwn(movedSkillFamilies, id);

/**
 * The moved skills whose extension copy is installed in this OpenCode: a receipt written by
 * `litopencode extensions install` (or the manual receipt line) for the same id and the litopencode variant.
 * Any unreadable record reads as not installed.
 */
export function installedExtensionSkills(configRoot: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const id of Object.keys(movedSkillFamilies)) {
    try {
      const file = path.join(configRoot, "skills", id, extensionReceipt);
      if (!fs.lstatSync(file).isFile()) continue;
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      if (record.id === id && record.variant === "litopencode") found.add(id);
    } catch { // no-excuse-ok: catch -- a missing or torn receipt means the extension is not installed.
      continue;
    }
  }
  return found;
}

export type SkillHatch = {
  readonly skills: readonly string[];
  readonly extra: readonly string[];
  readonly unknown: readonly string[];
  readonly rest: string;
};

const hatchPattern = /(?:^|\s)lit(?:work|opencode)?((?:\s+\+[A-Za-z][A-Za-z-]{0,30})+)(?=\s|$)/u;

/** `lit +viz +ui <task>`: the forced skills in the user's order, unknown names, and the text without them. */
export function parseSkillHatch(text: string): SkillHatch | undefined {
  const match = hatchPattern.exec(text);
  if (match === null) return undefined;
  const skills: string[] = [];
  const unknown: string[] = [];
  for (const token of match[1].trim().split(/\s+/u)) {
    const name = token.slice(1).toLowerCase();
    const id = skillPlanAliases[name] ?? (Object.hasOwn(skillPlanCatalog, name) ? name : undefined);
    if (id === undefined) unknown.push(name);
    else if (!skills.includes(id)) skills.push(id);
  }
  const rest = text.replace(/((?:^|\s)lit(?:work|opencode)?)(?:\s+\+[A-Za-z][A-Za-z-]{0,30})+(?=\s|$)/u, "$1");
  return { skills: skills.slice(0, skillPlanCap), extra: skills.slice(skillPlanCap), unknown, rest };
}

/** The same text with a `lit +…` plan removed, so routing reads the task and never the plan names. */
export function withoutSkillHatch(text: string): string {
  return parseSkillHatch(text)?.rest ?? text;
}

// Large or risky design asks: lit-crucible joins as the first companion. A request to explain or describe stays out.
const riskyDesignAsk = /(?<![a-z])(?:redesign(?:ing)?|re-?architect(?:ure|ing)?|architecture|migrat(?:e|ion|ing)|overhaul(?:ing)?)(?![a-z])|재설계|설계|아키텍처|마이그레이션|전면\s?개편/u;
const explainAsk = /(?<![a-z])(?:explain|describe|summari[sz]e|what\s+is)(?![a-z])|설명|요약/u;
const deliverables: ReadonlySet<string> = new Set([
  "lit-pptx",
  "lit-docx",
  "frontend-ui-ux",
  "lit-scientific-visualization",
  "lit-diagram-drawer",
  "lit-schematic",
  "lit-typographic-motion",
  "readme-studio"
]);

export function wantsCrucible(raw: string, ids: readonly string[]): boolean {
  if (explainAsk.test(raw)) return false;
  return riskyDesignAsk.test(raw) || ids.filter((id) => deliverables.has(id)).length >= 3;
}

export type SkillPlanEntry = {
  readonly id: string;
  readonly moved: boolean;
  readonly installed: boolean;
};

export type SkillPlan = {
  readonly entries: readonly SkillPlanEntry[];
  readonly dropped: readonly { readonly id: string; readonly why: string }[];
  readonly forced: boolean;
  readonly unknown: readonly string[];
  readonly readOnly: boolean;
};

/**
 * The ordered plan. `primary` is the routed skill; `companions` are the other matched routes in cascade order;
 * `forced` (from parseSkillHatch) replaces the companions. Undefined when the plan is the primary alone, so an
 * ordinary prompt's activation text stays exactly as it was.
 */
export function buildSkillPlan(input: {
  readonly primary: string;
  readonly companions?: readonly string[];
  readonly forced?: SkillHatch;
  readonly raw?: string;
  readonly installed?: ReadonlySet<string>;
}): SkillPlan | undefined {
  const { primary, forced } = input;
  const installed = input.installed ?? new Set<string>();
  const readOnly = readOnlyPrimaries.has(primary);
  const dropped: { id: string; why: string }[] = [];
  let picked = forced === undefined ? (input.companions ?? []).filter((id) => id !== primary) : forced.skills.filter((id) => id !== primary);
  if (forced === undefined && !readOnly && primary !== "lit-crucible" && !picked.includes("lit-crucible") && wantsCrucible(input.raw ?? "", [primary, ...picked])) {
    picked = ["lit-crucible", ...picked];
  }
  picked = [...new Set(picked)].filter((id) => {
    if (readOnly && !readOnlySkills.has(id)) {
      dropped.push({ id, why: `${primary} is read-only` });
      return false;
    }
    return true;
  });
  const cap = forced === undefined ? skillPlanCap - 1 : skillPlanCap;
  for (const id of picked.slice(cap)) dropped.push({ id, why: "over the cap" });
  picked = picked.slice(0, cap);
  if (picked.length === 0 && forced === undefined) return undefined;
  const entries = [primary, ...picked].map((id) => ({
    id,
    moved: isMoved(id),
    installed: isMoved(id) ? installed.has(id) : true
  }));
  return { entries, dropped, forced: forced !== undefined, unknown: forced?.unknown ?? [], readOnly };
}

/** The plan line, e.g. `Skill plan: 1 lit-loop (primary) → 2 lit-scientific-visualization (not installed: …)`. */
export function skillPlanLine(plan: SkillPlan): string {
  const missing = plan.entries.filter((entry) => entry.moved && !entry.installed).map((entry) => entry.id);
  let named = false;
  const label = (entry: SkillPlanEntry, index: number): string => {
    const lead = index === 0 ? " (primary)" : "";
    if (!entry.installed) {
      if (named) return `${entry.id}${lead} (not installed)`;
      named = true;
      return `${entry.id}${lead} (not installed: litopencode extensions install ${missing.join(" ")} --yes)`;
    }
    return `${entry.id}${lead}`;
  };
  return `Skill plan: ${plan.entries.map((entry, index) => `${index + 1} ${label(entry, index)}`).join(" → ")}`;
}

/** The plan's skill ids, bare. */
export function skillPlanIds(plan: SkillPlan | undefined): readonly string[] {
  return plan === undefined ? [] : plan.entries.map(({ id }) => id);
}

function catalogLines(plan: SkillPlan, installed: ReadonlySet<string>): string[] {
  const inPlan = new Set(plan.entries.map(({ id }) => id));
  return Object.entries(skillPlanCatalog)
    .filter(([id]) => !inPlan.has(id))
    .filter(([id]) => !plan.readOnly || readOnlySkills.has(id))
    .filter(([id]) => !isMoved(id) || installed.has(id))
    .map(([id, use]) => `${id} — ${use}`);
}

/** The model-facing block. Fixed text around the plan; nothing from the prompt is echoed. */
export function skillPlanContext(plan: SkillPlan, installed: ReadonlySet<string> = new Set()): string {
  const lines = [skillPlanLine(plan)];
  if (plan.forced) {
    lines.push("The user named this plan with `lit +…`: keep it exactly, add nothing and drop nothing.");
    if (plan.unknown.length > 0) lines.push(`Ignored unknown plan names: ${plan.unknown.map((name) => `+${name}`).join(" ")}.`);
  } else {
    lines.push("The companions after the primary are candidates the router matched, not orders: confirm or drop each one for this request, and add at most one skill from the catalog below when the work clearly needs it.");
  }
  for (const { id, why } of plan.dropped) lines.push(`Left out: ${id} (${why}).`);
  lines.push("State the final plan on the line right after the LIT IGNITED probe line, in the same `Skill plan: 1 … → 2 …` form. The primary is already active; load each companion with OpenCode's native skill tool when its part of the work starts, never all up front. A skill marked not installed is not loaded: give its install line once and carry on without it.");
  const catalog = plan.forced ? [] : catalogLines(plan, installed);
  if (catalog.length > 0) lines.push(`Catalog (installed here): ${catalog.join("; ")}.`);
  return `<litopencode-skill-plan>\n${lines.join("\n")}\n</litopencode-skill-plan>`;
}
