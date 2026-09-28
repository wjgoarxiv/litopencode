import { readFileSync } from "node:fs";
import type { LitOpenCodeRuntimeSkillId } from "../skills.ts";
import { renamedSkillIds } from "../skill-renames.ts";

// A skill becomes "managed" when it ships assets beyond SKILL.md: the installer then reproduces its
// local tree and both exact-tree gates pin the file set. External canonical roots stay unchanged in
// the package and install as a private canonical/ subtree of their native wrapper. lit-plan joined this list when it gained
// scripts/scaffold-plan.mjs, because the skill invokes that script by skill-root path and a script
// that does not install cannot be invoked.
export type ManagedSkillId =
  | "lit-comprehend"
  | "lit-handoff"
  | "lit-scientific-visualization"
  | "lit-diagram-drawer"
  | "lit-pptx"
  | "lit-typographic-motion"
  | "lit-docx"
  | "readme-studio"
  | "frontend-ui-ux"
  | "visual-qa"
  | "lit-plan"
  | "browser-drive"
  | "lit-humanizer"
  | "autoresearch"
  | "autoconference"
  | "wikify";

export type CanonicalManagedAsset = {
  readonly path: string;
  readonly sha256: string;
};

export type ManagedSkillDefinition = {
  readonly distributionFiles: readonly string[];
  /** Canonical assets may live outside the native skill wrapper, at this path relative to it. */
  readonly canonicalRoot?: string;
  readonly canonicalFiles: readonly CanonicalManagedAsset[];
};

export type ManagedVendorAsset = CanonicalManagedAsset;

type ManagedSkillManifest = {
  readonly schemaVersion: 1;
  readonly renamedSkills?: Readonly<Partial<Record<LitOpenCodeRuntimeSkillId, string | readonly string[]>>>;
  readonly vendorFiles?: readonly ManagedVendorAsset[];
  readonly skills: Readonly<Record<ManagedSkillId, ManagedSkillDefinition>>;
};

const manifestUrl = new URL("../../skills/managed-skill-manifest.json", import.meta.url);
const managedSkillManifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as ManagedSkillManifest;

if (managedSkillManifest.schemaVersion !== 1) {
  throw new Error(`Unsupported managed-skill manifest schema: ${String(managedSkillManifest.schemaVersion)}`);
}

export function managedSkillDefinition(id: LitOpenCodeRuntimeSkillId): ManagedSkillDefinition | undefined {
  if (
    id !== "lit-comprehend" &&
    id !== "lit-handoff" &&
    id !== "lit-scientific-visualization" &&
    id !== "lit-diagram-drawer" &&
    id !== "lit-pptx" &&
    id !== "lit-typographic-motion" &&
    id !== "lit-docx" &&
    id !== "browser-drive" &&
    id !== "lit-humanizer" &&
    id !== "readme-studio" &&
    id !== "frontend-ui-ux" &&
    id !== "visual-qa" &&
    id !== "lit-plan" &&
    id !== "autoresearch" &&
    id !== "autoconference" &&
    id !== "wikify"
  ) {
    return undefined;
  }
  return managedSkillManifest.skills[id];
}

export function managedVendorAssets(): readonly ManagedVendorAsset[] {
  return managedSkillManifest.vendorFiles ?? [];
}

export function previousManagedSkillId(id: LitOpenCodeRuntimeSkillId): string | undefined {
  const previous = managedSkillManifest.renamedSkills?.[id];
  const expected = Object.entries(renamedSkillIds).find(([canonical]) => canonical === id)?.[1];
  const first = Array.isArray(previous) ? previous[0] : previous;
  if (first !== expected) throw new Error(`Managed skill rename manifest drift: ${id}`);
  return first;
}

export function assetPathsForManagedSkill(id: LitOpenCodeRuntimeSkillId): readonly string[] {
  const definition = managedSkillDefinition(id);
  if (definition === undefined) return [];
  return [
    ...definition.distributionFiles.filter((relativePath) => relativePath !== "SKILL.md"),
    ...(definition.canonicalRoot === undefined ? definition.canonicalFiles.map((asset) => asset.path) : [])
  ];
}

export function expectedManagedSkillFiles(id: LitOpenCodeRuntimeSkillId): readonly string[] {
  const definition = managedSkillDefinition(id);
  return definition === undefined
    ? ["SKILL.md"]
    : [
        ...definition.distributionFiles,
        ...(definition.canonicalRoot === undefined ? definition.canonicalFiles.map((asset) => asset.path) : [])
      ];
}

export const installedCanonicalDirectory = "canonical";

export function nativeManagedSkillReferences(id: LitOpenCodeRuntimeSkillId, content: string): string {
  const root = managedSkillDefinition(id)?.canonicalRoot;
  return root === undefined ? content : content.replaceAll(root, `./${installedCanonicalDirectory}`);
}

export function expectedInstalledSkillFiles(id: LitOpenCodeRuntimeSkillId): readonly string[] {
  const definition = managedSkillDefinition(id);
  return definition?.canonicalRoot === undefined
    ? expectedManagedSkillFiles(id)
    : [
        ...definition.distributionFiles,
        ...definition.canonicalFiles.map((asset) => `${installedCanonicalDirectory}/${asset.path}`)
      ];
}

export function isRecursivelyManagedSkill(id: LitOpenCodeRuntimeSkillId): id is ManagedSkillId {
  return managedSkillDefinition(id) !== undefined;
}

// Every runtime skill id must map to a capability-shaped trigger, because this string is the ONLY
// thing the host reads when deciding whether to surface a skill. A name-echo description ("trigger
// when the user asks for <id>") fires only when the user already knows the skill exists, so it never
// surfaces the skill at the moment it is needed. The record is total by type: adding a runtime skill
// id without writing its trigger is a compile error, not a silent fallback.
const skillDiscoveryDescriptions = Object.freeze({
  "workflow-loop":
    "Trigger when the user wants a multi-step LitOpenCode work loop started, resumed, or kept running — bare `lit`, `/lit`, `/litwork`, \"keep going\", \"continue the loop\" — or when a request needs goal binding, ordered execution, and ledger-backed progress across turns instead of one answer.",
  "durable-litgoal":
    "Trigger when work needs an objective that outlives the current turn: binding a goal with checkable criteria, reading or appending the `.litopencode/litgoal` ledger, resuming a schema-3 bounded-authority work record, or answering \"what was I working on\" from durable state rather than chat memory.",
  "agent-roster":
    "Trigger when deciding which OpenCode agent should do the work, and again the moment work is about to be split across several lanes at once — before delegating through the task tool, when a request fans out into planning, implementation, review, research, or verification lanes, or when the user asks which agents exist and what each is permitted to touch. Delegation here is depth-one, so lanes need non-overlapping slices, explicit per-lane state, and a completion claim that aggregates every lane's evidence rather than summarising it.",
  "lit-plan":
    "Trigger when the user asks for a plan, checklist, approach, or design before implementation, or when a request is large or risky enough that execution must not start until scope, non-goals, ordered action/output/verification items, and a falsifiable DoneClaim are agreed. Do not trigger to perform the work itself.",
  "start-work":
    "Trigger when an approved plan or an explicit go-ahead already exists and implementation should begin or resume — \"start work\", \"execute the plan\", \"pick up where we left off\" — so the loop runs in verifiable slices with delegation lanes, evidence, and an independent verifier before any completion claim.",
  "review-work":
    "Trigger when something must be judged rather than produced: a draft plan needing a PASS / ITERATE / NEEDS-CONTEXT achievability verdict, or finished work needing the five-lane scope-diff, tests-evidence, package-payload, security-provenance, and real-surface-docs check before it can be called done.",
  litresearch:
    "Trigger when a question needs sourced investigation rather than recall — comparing options, confirming whether a library, API, or behavior actually works as claimed, gathering public evidence across several sources — so verified facts, hypotheses, contradictions, and residual uncertainty stay separated before a verdict.",
  "reference-benchmark-claims":
    "Trigger before writing any comparative or superiority claim about this package — \"faster than\", \"better than\", \"always wins\", \"무조건\" — so the wording is classified against the measured benchmark suite and universal all-task claims are blocked rather than shipped.",
  "native-goal-verdict":
    "Trigger when someone assumes the OpenCode host has a built-in goal primitive — asking for `/goal`, native goal tracking, or host-side objective state — so the answer reflects the verified host capability and routes to LitOpenCode durable goal state instead of promising an integration that does not exist.",
  "doctor-installer":
    "Trigger when the plugin itself must be installed, inspected, repaired, or previewed: \"install litopencode\", missing commands or skills after an update, a plugin that will not load, editing `litopencode.json` routes, or testing an unpublished local checkout before it reaches a registry.",
  "search-workflow-ideas":
    "Trigger when planning how to retrieve something from public sources — choosing a route, deciding what counts as evidence for a retrieval claim, or setting the A/B probes that must prove a behavior change across the CLI, plugin, command, tool, and package surfaces.",
  "lit-fetch":
    "Trigger when a public HTTP(S) page, README, raw file, or API response must actually be fetched, so retrieval runs through the SSRF guards and returns a typed verdict, and so authentication, paywall, rate-limit, consent, and challenge boundaries become stop conditions instead of improvised workarounds.",
  "release-guardrails":
    "Trigger before any release-shaped action — version bump, tag, publish, changelog, \"is this ready to ship\" — so vocabulary scanning, version lockstep, and a real dry-pack manifest run before the claim is made and publication stays behind explicit user approval.",
  "lit-init":
    "Trigger when a repository needs agent-facing guidance created or refreshed: \"set up AGENTS.md\", \"document this repo for agents\", onboarding an unfamiliar codebase, or a restructure that left directory guidance stale and misleading.",
  "lit-crucible":
    "Trigger before planning when the approach itself is uncertain, contested, or expensive to reverse — competing designs, hidden coupling, a request to pressure-test assumptions or find what will go wrong — so independent read-only lanes attack the idea and only surviving evidence-backed insights reach lit-plan.",
  refactor:
    "Trigger when code should change shape without changing behavior: extracting, renaming, deduplicating, splitting an overgrown module, or paying down structure the user calls messy or hard to follow — so the behavior boundary is pinned by before/after checks and feature work is not smuggled into the diff.",
  "lit-burnoff":
    "Trigger when text or code reads as machine-written and should not — comments restating the code, hedging filler, decorative headings, invented emphasis — or when the user asks to \"clean this up\", \"make it less AI\", or strip generated padding, while facts, APIs, tests, and accessibility behavior stay intact.",
  "lit-burnoff-file":
    "Trigger right after a single source file was edited and should be cleaned against its own diff — restated comments, hedging filler, unused scaffolding, an abstraction introduced for one call site — without touching any other file or changing what the code does.",
  "comment-checker":
    "Trigger right after an edit added or changed comments, to decide per comment whether it survives: delete anything that restates the line below it, keep anything that records a reason, a constraint, or a trap the code cannot state itself.",
  "lit-code":
    "Trigger whenever code is being written or changed — implementing a feature, fixing a defect, adding a test, wiring a surface — so the smallest correct change wins over an invented abstraction and the change is paired with a real-surface probe before it is claimed done.",
  debugging:
    "Trigger when something is broken and the cause is not yet known — a failing test, a stack trace, a wrong result, \"it worked yesterday\", flaky or intermittent behavior, a fix that did not take — so the failure is reproduced and the mechanism proven before any code is edited.",
  "lit-commit":
    "Trigger for any git operation or question: staging, committing, branching, diff review, an unexpectedly dirty worktree, rebase or history inspection, or preparing a PR — so state is inspected before it is mutated and no commit, push, tag, reset, clean, or history rewrite happens without explicit authorization.",
  lsp:
    "Trigger when a code question is better answered by the language server than by reading files — real diagnostics after an edit, where a symbol is defined, who calls it, what a type actually resolves to — and when a rename or signature change needs its true blast radius before it is made.",
  "lsp-setup":
    "Trigger when the file type being edited has no language server behind it — diagnostics come back empty for a language the host does not serve, or the user asks why there are no errors, no go-to-definition, no rename — so the gap is named and a compiler or test fallback replaces the missing signal.",
  rules:
    "Trigger before editing an unfamiliar repository, or when the user invokes house style, conventions, or \"the rules\" — so the shipped rule files are located and ordered before code is written rather than discovered by a reviewer afterwards.",
  "deep-interview":
    "Trigger when a request is too broad or underspecified to plan — \"make it better\", \"add auth\", \"build the dashboard\", a one-line feature ask with no acceptance criteria — so the forks that change scope, risk, or acceptance get settled into a decision-complete brief before lit-plan starts.",
  "browser-drive":
    "Trigger only when the answer lives in a running page and the user explicitly asked to drive one \u2014 the exact `browser-drive` name, or a page task that no document can settle. LitOpenCode bundles no browser and no driver: probe by identity, quote the probe, and stop at BLOCKED_BROWSER_DRIVER_UNAVAILABLE, BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED, or BLOCKED_BROWSER_DRIVER_CLEANUP_FAILED rather than substituting a fetch. A passing mention of a browser or a URL is not a request, and checking how a surface looks is visual-qa.",
  "structural-search":
    "Trigger when the target of a search or a rewrite is a syntax SHAPE rather than a string — \"find every call site that passes a callback\", \"rewrite these imports\", \"locate declarations of this form\", any codemod — so the query survives line breaks, argument spread, and comments that defeat a regex. Also when a text search has already produced a match set nobody trusts. LitOpenCode bundles no engine: probe by identity, and label a textual fallback as textual.",
  "lit-humanizer":
    "Trigger when a reader-facing draft needs a focused prose revision — translated-sounding or templated wording, a request to 자연스럽게 / 다듬기 / revise for the reader, or review of documentation, reports, slides, comments, or README text — while preserving meaning, facts, citations, useful qualifiers, and the author's voice.",
  "lit-comprehend":
    "Trigger when the user needs to UNDERSTAND completed work rather than just see its status — after a long agent session, an overnight lit-loop, or a multi-file change — so the answer is a self-contained explainer with delta-anchored themes, intuition-first diagrams, and a micro-world, not a chronological recap.",
  "lit-recap":
    "Trigger when the user asks what has happened so far — \"recap\", \"리캡\", \"where are we\", \"summarize this session\", or resuming after a break — so the answer is a read-only Korean-default digest built from the durable ledger and session evidence instead of a new action.",
  "lit-handoff":
    "Trigger only for explicit `/lit-handoff`, an exact bare `handoff` message, or native selection by the exact `lit-handoff` id.",
  "lit-scientific-visualization":
    "Trigger only for explicit `/lit-scientific-visualization`, an exact bare `lit-scientific-visualization` message, or native selection by the exact `lit-scientific-visualization` id.",
  "lit-diagram-drawer":
    "Select this skill from OpenCode's native skill picker when the user needs an architecture map, workflow, schema, decision path, schedule, or conceptual chart. Route product pages and interface layouts to frontend-ui-ux; route measured scientific data and statistical figures to lit-scientific-visualization. Do not claim a slash command or bare-chat route.",
  "lit-pptx":
    "Select for a PowerPoint deck or presentation, including a bounded lit request for slides. Keep editable Markdown and PPTX together, run the QA gate, and inspect the render.",
  "lit-typographic-motion":
    "Select for a new film or video. Write the treatment first, then render on the stage path (a captured page) or the type path (words alone), gate it and look at the frames; editing existing footage or embedding a video in a page is outside this route.",
  "lit-docx":
    "Select for a Word report, proposal, or document, including a bounded lit report request. Keep editable Markdown and DOCX together; select publisher profiles when specified and inspect rendered pages.",
  "readme-studio":
    "Select by native skill name for factual README writing and local cover composition. Inspect actual session image capability; never infer generation support or authorize publication from selection.",
  "frontend-ui-ux":
    "Trigger the moment interface work is described, not after it starts — \"design a settings page\", \"redesign the dashboard\", \"build a login screen\", or any making verb aimed at a UI, screen, layout, component, or stylesheet — so compact direction and existing tokens shape the authorized build. Evolve the contract with implementation and inspect renders; review and plan intent remains read-only. Also on the exact `frontend-ui-ux` id. The SKILL.md reference router names which of the sixteen shipped reference documents answers which question.",
  "visual-qa":
    "Trigger when a rendered surface needs to be checked rather than described — an explicit `visual-qa` request, or verifying that an interface change actually looks and behaves right. Selection does not make a browser callable: the shipped capture playbook names the exact blocked code per unavailable channel, and a blocked check reported honestly outranks an unproven pass.",
  autoresearch:
    "Trigger when a measurable objective needs repeated hypothesis, experiment, evaluation, and keep/revert decisions, or when its debug, fix, learn, plan, predict, reason, scenario, security, or readiness modes fit the request.",
  autoconference:
    "Trigger when several genuinely independent research lanes should explore partitions and exchange peer-reviewed packets; block rather than role-play when the current root lacks real OpenCode task capability.",
  wikify:
    "Trigger when the current project needs a maintained local markdown wiki: initialize structure, ingest inert sources, query grounded pages, save durable context, or lint provenance, navigation, contradictions, and drift."
} satisfies Record<LitOpenCodeRuntimeSkillId, string>);

export function managedSkillDiscoveryDescription(id: LitOpenCodeRuntimeSkillId): string {
  return skillDiscoveryDescriptions[id];
}
