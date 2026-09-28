import { frontendUiUxFeature, visualQaFeature } from "./uiux-visual-catalog.ts";

export type LitOpenCodeBindingKind = "agent" | "cli" | "command" | "config" | "hook" | "tool";

export type LitOpenCodeFeatureId =
  | "planning-start-work-loop"
  | "lit-litwork-activation"
  | "start-work"
  | "review-work"
  | "litresearch"
  | "durable-ledger"
  | "bounded-authority-lifecycle"
  | "agent-roster"
  | "lit-plan"
  | "reference-benchmark-claims"
  | "native-goal-verdict"
  | "doctor-install"
  | "search-workflow-ideas"
  | "lit-fetch"
  | "guardrails"
  | "lit-init"
  | "lit-crucible"
  | "refactor"
  | "lit-burnoff"
  | "lit-burnoff-file"
  | "comment-checker"
  | "lit-code"
  | "debugging"
  | "lit-commit"
  | "lsp"
  | "lsp-setup"
  | "rules"
  | "deep-interview"
  | "structural-search"
  | "browser-drive"
  | "lit-humanizer"
  | "lit-recap"
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
  | "autoresearch"
  | "autoconference"
  | "wikify";

export type LitOpenCodeFeatureBinding = {
  readonly kind: LitOpenCodeBindingKind;
  readonly id: string;
  readonly surface: string;
  readonly description: string;
};

export type LitOpenCodeFeature = {
  readonly id: LitOpenCodeFeatureId;
  readonly title: string;
  readonly summary: string;
  readonly bindings: readonly LitOpenCodeFeatureBinding[];
  readonly verification: readonly string[];
};

export const litOpenCodeFeatures = Object.freeze([
  {
    id: "autoresearch",
    title: "Autoresearch Family",
    summary: "Installs one recursively managed ten-mode family and exposes hyphen-native planning-gated OpenCode command/chat routes without adding tools or agents.",
    bindings: [
      { kind: "command", id: "autoresearch-family", surface: "OpenCode command aliases /autoresearch and /autoresearch-<mode>", description: "Selects a nested mode and injects the bounded lifecycle contract." },
      { kind: "hook", id: "chat.message", surface: "OpenCode chat.message hook", description: "Recognizes only a leading family invocation outside slash, quote, fence, blockquote, and inline-code data." },
      { kind: "config", id: "skills/autoresearch/SKILL.md", surface: "LitOpenCode native-installed managed skill", description: "Ships ten modes, templates, references, local helpers, provenance, and license as one exact tree." }
    ],
    verification: ["node --test test/workflow-family-skills.test.mjs", "node --test test/cli-install-surface.test.mjs"]
  },
  {
    id: "autoconference",
    title: "Autoconference Family",
    summary: "Installs one seven-mode conference family that requires live OpenCode task capability and keeps children depth-one and packet-only.",
    bindings: [
      { kind: "command", id: "autoconference-family", surface: "OpenCode command aliases /autoconference and /autoconference-<mode>", description: "Selects a nested conference mode behind planning and capability gates." },
      { kind: "hook", id: "chat.message", surface: "OpenCode chat.message hook", description: "Recognizes only leading family invocations and injects the fail-closed capability contract." },
      { kind: "config", id: "skills/autoconference/SKILL.md", surface: "LitOpenCode native-installed managed skill", description: "Ships seven modes and the complete conference packet/protocol closure as one exact tree." }
    ],
    verification: ["node --test test/workflow-family-skills.test.mjs", "node --test test/subagent-recursion.test.mjs"]
  },
  {
    id: "wikify",
    title: "Wikify Family",
    summary: "Installs one five-mode local-wiki family with reviewed project-local structured knowledge and deterministic accepted-record relevance.",
    bindings: [
      { kind: "command", id: "wikify-family", surface: "OpenCode command aliases /wikify-init through /wikify-lint", description: "Operates on structured local claims while raw arguments stay inert and unpersisted." },
      { kind: "hook", id: "chat.message", surface: "OpenCode chat.message hook", description: "Injects accepted deterministic local relevance only when records match; no match stays silent." },
      { kind: "hook", id: "tool.execute.after", surface: "OpenCode tool.execute.after hook", description: "Captures only an already-structured metadata event after validation and never parses tool output." },
      { kind: "tool", id: "wikify", surface: "OpenCode Wikify tool", description: "Captures review-needed claims and performs explicit save, review, query, or status operations." },
      { kind: "config", id: "knowledge.capture", surface: "LitOpenCode project config", description: "Enables capture by default and provides a project-local false opt-out without disabling query." },
      { kind: "config", id: "skills/wikify/SKILL.md", surface: "LitOpenCode native-installed managed skill", description: "Ships five modes and five templates with provenance and exact-tree installation." }
    ],
    verification: ["node --test test/wikify-knowledge.test.mjs", "node tools/run-wikify-surface-probe.mjs", "node --test test/workflow-family-skills.test.mjs"]
  },
  {
    id: "planning-start-work-loop",
    title: "Planning And Work Loop",
    summary:
      "Coordinates plan-first work, scoped implementation, independent verification, and evidence-backed progress.",
    bindings: [
      {
        kind: "command",
        id: "litwork",
        surface: "OpenCode command /litwork",
        description: "Resumes the work loop and writes a command activation event to the durable ledger."
      },
      {
        kind: "command",
        id: "start-work",
        surface: "OpenCode command /start-work",
        description: "Starts or resumes plan-backed implementation with evidence checkpoints."
      },
      {
        kind: "agent",
        id: "lit-plan",
        surface: "OpenCode agent lit-plan",
        description: "Provides the primary planning surface for executable, verified work slices."
      },
      {
        kind: "agent",
        id: "lit-loop",
        surface: "OpenCode agent lit-loop",
        description: "Provides the primary execution-loop surface for scoped edits and command-backed delivery."
      }
    ],
    verification: ["node --test test/litwork.test.mjs", "node --test test/agent-roster.test.mjs"]
  },
  {
    id: "lit-litwork-activation",
    title: "Lit Activation Surface",
    summary: "Exposes LitOpenCode activation through command and tool surfaces backed by observable ledger events.",
    bindings: [
      {
        kind: "command",
        id: "lit",
        surface: "OpenCode command /lit",
        description: "Activates the model probe line and records command activation."
      },
      {
        kind: "tool",
        id: "lit",
        surface: "OpenCode tool lit",
        description: "Initializes the runtime ledger and reports status."
      },
      {
        kind: "tool",
        id: "litwork",
        surface: "OpenCode tool litwork",
        description: "Starts or inspects the current work loop through durable ledger operations."
      },
      {
        kind: "hook",
        id: "command.execute.before",
        surface: "OpenCode hook command.execute.before",
        description: "Injects activation text before supported slash commands execute."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode hook chat.message",
        description: "Injects mode-aware LitOpenCode guidance for standalone lit routes, while requiring start-work chat handoff to be an explicit leading invocation."
      }
    ],
    verification: ["node --test test/litwork.test.mjs"]
  },
  {
    id: "start-work",
    title: "Start Work",
    summary: "Provides the plan-backed implementation start surface used to begin or resume verified work.",
    bindings: [
      {
        kind: "command",
        id: "start-work",
        surface: "OpenCode command /start-work",
        description: "Activates the start-work directive."
      },
      {
        kind: "tool",
        id: "start-work",
        surface: "OpenCode tool start-work",
        description: "Records start-work activation and reports durable ledger status."
      }
    ],
    verification: ["node --test test/litwork.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "review-work",
    title: "Review Work",
    summary: "Provides read-only draft-plan achievability review and five-lane completed-work review with evidence-backed verdicts.",
    bindings: [
      {
        kind: "command",
        id: "review-work",
        surface: "OpenCode command /review-work",
        description: "Reviews either a draft plan or completed work without implementing the reviewed artifact."
      },
      {
        kind: "tool",
        id: "review-work",
        surface: "OpenCode tool review-work",
        description: "Records review-work activation and exposes draft-plan or completed-work review guidance."
      }
    ],
    verification: ["node --test test/litwork.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "litresearch",
    title: "LitResearch",
    summary: "Provides an evidence-backed, root-owned research surface with bounded task waves, append-only evidence receipts, sequential fallback, scientific-record statuses, and uncertainty tracking.",
    bindings: [
      {
        kind: "command",
        id: "litresearch",
        surface: "OpenCode command /litresearch",
        description: "Activates the litresearch directive through the compact command alias."
      },
      {
        kind: "command",
        id: "lit-research",
        surface: "OpenCode command /lit-research",
        description: "Activates the litresearch directive through the hyphenated command alias."
      },
      {
        kind: "config",
        id: "skills/litresearch/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Documents root-owned bounded waves, durable claim/evidence receipts, public route failure gates, scientific-record review states, and safety boundaries."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode hook chat.message",
        description: "Routes bare litresearch and natural lit research prompts to the research guidance."
      }
    ],
    verification: ["node --test test/litwork.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "durable-ledger",
    title: "Durable LitGoal Ledger",
    summary: "Persists loop events under .litopencode/litgoal with atomic writes and temp-file recovery.",
    bindings: [
      {
        kind: "tool",
        id: "litwork.status",
        surface: "OpenCode tool litwork action=status",
        description: "Reads durable ledger events for status output."
      },
      {
        kind: "config",
        id: ".litopencode/litgoal",
        surface: "litopencode runtime state path",
        description: "Owns the durable ledger directory used by commands, tools, and goal operations."
      }
    ],
    verification: ["node --test test/ledger.test.mjs", "node --test test/litwork.test.mjs"]
  },
  {
    id: "bounded-authority-lifecycle",
    title: "Bounded Authority Lifecycle",
    summary: "Owns schema-3 init, pause, trusted resume, cancel, complete, progress continuation, CAS, reconciliation, and bounded durable compaction without broadening authority.",
    bindings: [
      {
        kind: "command",
        id: "start-work.lifecycle",
        surface: "OpenCode command /start-work",
        description: "Accepts strict init, resume, cancel, complete, and status directives from the trusted slash-command route."
      },
      {
        kind: "hook",
        id: "event",
        surface: "OpenCode event hook",
        description: "Parses exact fenced assistant progress and emits one structured continuation for each genuinely new active-work checkpoint."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode hook chat.message",
        description: "Accepts only exact root-user start-work resume directives; copied, quoted, slash, and delegated text remains inert."
      },
      {
        kind: "tool",
        id: "start-work",
        surface: "OpenCode tool start-work",
        description: "Keeps generic agent-callable resume unavailable, so only trusted user routes can consume a matching boundary grant."
      },
      {
        kind: "config",
        id: "boundedAuthority",
        surface: "litopencode.json boundedAuthority settings",
        description: "Bounds event history, state history, idempotence receipts, and context-file bytes."
      }
    ],
    verification: [
      "node --test test/bounded-authority-lifecycle.test.mjs",
      "node --test test/bounded-authority-hooks.test.mjs",
      "node --test test/cli-install-surface.test.mjs"
    ]
  },
  {
    id: "agent-roster",
    title: "Agent Roster",
    summary: "Registers the three primary LitOpenCode agents, recommended role aliases, and specialist roster as static OpenCode agent definitions.",
    bindings: [
      {
        kind: "hook",
        id: "config",
        surface: "OpenCode config hook",
        description: "Merges LitOpenCode agent definitions into the host config without overwriting existing agents."
      },
      {
        kind: "agent",
        id: "primary-defaults",
        surface: "OpenCode agent registry",
        description: "Provides the lit-plan, lit-implement, and lit-loop primary default agents, with lit-plan guarded against edit/bash/task execution until start-work hands off to lit-implement."
      },
      {
        kind: "agent",
        id: "recommended-roles",
        surface: "OpenCode agent registry",
        description: "Provides architect, forge, oracle, prover, sentinel, and librarian role aliases."
      },
      {
        kind: "agent",
        id: "specialists",
        surface: "OpenCode agent registry",
        description: "Provides the adapted specialist set for advanced discovery, review, planning, and persistence."
      }
    ],
    verification: ["node --test test/agent-roster.test.mjs"]
  },
  {
    id: "lit-plan",
    title: "Lit Plan",
    summary:
      "Documents proportionate objective-achievable checklists on the OpenCode planning-only surface, including approval gates, read-only boundaries, and start-work handoff.",
    bindings: [
      {
        kind: "agent",
        id: "lit-plan",
        surface: "OpenCode agent lit-plan",
        description: "Produces ordered action/output/verification checklists; edit/bash/task remain denied and execution waits for explicit user confirmation."
      },
      {
        kind: "command",
        id: "lit-plan",
        surface: "OpenCode command /lit-plan",
        description: "Injects lit-plan guidance with the installed static skill body."
      },
      {
        kind: "config",
        id: "skills/lit-plan/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Documents adaptive checklist detail, gated unknowns, decision branches, DoneClaim evidence, and the start-work handoff."
      }
    ],
    verification: ["node --test test/litwork.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "reference-benchmark-claims",
    title: "Reference Benchmark Claims",
    summary:
      "Exposes the benchmark-backed claim policy that blocks universal REFERENCE superiority claims unless they are scoped to a measured OpenCode-native suite.",
    bindings: [
      {
        kind: "config",
        id: "litOpenCodeReferenceBenchmark",
        surface: "litopencode exported benchmark policy API",
        description: "Defines finite task categories, required artifacts, scoring dimensions, and pass thresholds."
      },
      {
        kind: "config",
        id: "classifyReferenceSuperiorityClaim",
        surface: "litopencode exported claim guard API",
        description: "Blocks unconditional all-task superiority wording and returns the safe benchmark-scoped alternative."
      },
      {
        kind: "config",
        id: "benchmarkGateAllowsStrongClaim",
        surface: "litopencode exported benchmark gate API",
        description: "Allows strong REFERENCE comparison wording only after the finite benchmark thresholds pass."
      }
    ],
    verification: ["node --test test/benchmark-claims.test.mjs", "node --test test/packed-artifact.test.mjs"]
  },
  {
    id: "native-goal-verdict",
    title: "Native Goal Verdict",
    summary:
      "Documents that the local OpenCode CLI and plugin type surface do not expose a native goal primitive; LitOpenCode therefore owns durable goal state under .litopencode/litgoal.",
    bindings: [
      {
        kind: "cli",
        id: "opencode --help",
        surface: "OpenCode CLI command list",
        description: "The verified local CLI exposes plugin, agent, run, session, and related commands, but no goal command."
      },
      {
        kind: "hook",
        id: "@opencode-ai/plugin Hooks",
        surface: "OpenCode plugin type surface",
        description: "The verified Hooks type exposes config, tool, chat, command, permission, shell, provider, auth, event, and dispose surfaces, but no native goal hook."
      },
      {
        kind: "config",
        id: ".litopencode/litgoal",
        surface: "LitOpenCode durable goal ledger",
        description: "LitOpenCode uses its own ledger as the host-adapted goal state surface when the host has no native goal primitive."
      }
    ],
    verification: ["opencode --help", "node --test test/runtime-skills.test.mjs", "node --test test/docs.test.mjs"]
  },
  {
    id: "doctor-install",
    title: "Doctor And Installer CLI",
    summary: "Reports package, route config, and state health and installs or previews the OpenCode plugin plus LitOpenCode route config mutation.",
    bindings: [
      {
        kind: "cli",
        id: "litopencode doctor",
        surface: "litopencode CLI doctor command",
        description: "Reports package metadata, config source, litopencode.json route validity, effective agent routes, runtime paths, and state presence without writes."
      },
      {
        kind: "cli",
        id: "npm exec --package @litfamily/litopencode -- litopencode install",
        surface: "litopencode CLI install command",
        description: "Delegates default setup to OpenCode's plugin installer, creates litopencode.json when missing, preserves existing route config, or previews both mutations with --dry-run."
      },
      {
        kind: "config",
        id: "permissionMode: safe|balanced|yolo",
        surface: "LitOpenCode route config and OpenCode config hook",
        description: "Explicit permission preference modes: safe leaves OpenCode ask-first behavior, balanced allows routine automation while keeping dangerous bash patterns on ask, and yolo allows bash/edit/webfetch/external_directory globally. Both relaxed modes grant task delegation only to execution-capable primary agents, keep lit-plan and subagents task-denied so the planner stays read-only and child delegation stays depth-one, and preserve lit-plan edit/bash/task deny guards."
      }
    ],
    verification: ["node --test test/cli.test.mjs", "node --test test/config-state.test.mjs"]
  },
  {
    id: "search-workflow-ideas",
    title: "Search Workflow Ideas",
    summary:
      "Exposes brand-clean, static public-source retrieval guidance with route fallback, explicit verdicts, SSRF boundaries, evidence traces, and A/B checks.",
    bindings: [
      {
        kind: "config",
        id: "litOpenCodeSearchWorkflowIdeas",
        surface: "litopencode exported workflow catalog API",
        description: "Provides immutable public-source retrieval workflow ideas for agents and package consumers."
      },
      {
        kind: "config",
        id: "findLitOpenCodeSearchWorkflowIdea",
        surface: "litopencode exported workflow lookup API",
        description: "Looks up a single workflow idea by id without changing hooks, tools, commands, or installer behavior."
      }
    ],
    verification: ["node --test test/search-workflow-ideas.test.mjs", "node --test test/packed-artifact.test.mjs"]
  },
  {
    id: "lit-fetch",
    title: "Lit Fetch",
    summary:
      "Fetches public HTTP(S) sources with SSRF guards, manual redirect validation, access verdicts, byte limits, and trace output.",
    bindings: [
      {
        kind: "command",
        id: "lit-fetch",
        surface: "OpenCode command /lit-fetch",
        description: "Selects the canonical skill through explicit command or bounded chat activation."
      },
      {
        kind: "config",
        id: "fetchPublicSource",
        surface: "litopencode exported public-source fetch API",
        description: "Retrieves public sources and returns ok, verdict, finalUrl, content, and trace fields."
      },
      {
        kind: "cli",
        id: "litopencode fetch-public",
        surface: "litopencode CLI fetch-public command",
        description: "Runs the public-source fetch runtime from the terminal with --json output for automation."
      }
    ],
    verification: ["node --test test/lit-fetch.test.mjs", "node --test test/cli.test.mjs", "node --test test/packed-artifact.test.mjs"]
  },
  {
    id: "guardrails",
    title: "Release Guardrails",
    summary: "Keeps release-sensitive checks visible through npm-script and CI gates before package publication work.",
    bindings: [
      {
        kind: "cli",
        id: "npm run scan:legacy-tokens",
        surface: "npm guard command",
        description: "Fails on guarded vocabulary unless an exact line-level exception is documented."
      },
      {
        kind: "cli",
        id: "npm run check:version",
        surface: "npm guard command",
        description: "Verifies package metadata and lockfile version lockstep."
      },
      {
        kind: "cli",
        id: "npm run check:pack-payload",
        surface: "npm guard command",
        description: "Verifies the dry pack manifest excludes local state, evidence, archives, and fixtures."
      }
    ],
    verification: ["npm run scan:legacy-tokens", "npm run check:version", "npm run check:pack-payload"]
  },
  {
    id: "lit-init",
    title: "Lit Init",
    summary:
      "Documents the OpenCode-adapted workflow for creating sparse, evidence-backed AGENTS.md knowledge hierarchies.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-init/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the lit-init workflow for repository discovery, directory scoring, careful AGENTS.md edits, and verification."
      },
      {
        kind: "command",
        id: "lit-init",
        surface: "OpenCode command /lit-init",
        description: "Makes the lit-init workflow directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "agent",
        id: "read-only exploration lanes",
        surface: "OpenCode task delegation and file-reading tools",
        description: "Uses read-only exploration lanes plus local file inspection before any AGENTS.md file is created or updated."
      }
    ],
    verification: ["node --test test/runtime-skills.test.mjs", "node --test test/docs.test.mjs", "node --test test/static-workflow-command.test.mjs"]
  },
  {
    id: "lit-crucible",
    title: "Lit Crucible",
    summary:
      "Documents an adversarial planning workflow that pressure-tests assumptions before handing a surviving insight bundle to lit-plan.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-crucible/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the lit-crucible adversarial planning contract, critique loop, and lit-plan handoff boundary."
      },
      {
        kind: "command",
        id: "lit-crucible",
        surface: "OpenCode command /lit-crucible",
        description: "Makes Lit Crucible directly invocable as a planning-only installed OpenCode command alias."
      },
      {
        kind: "agent",
        id: "independent planning lanes",
        surface: "OpenCode task delegation and planning agents",
        description: "Uses independent read-only lanes to find risks, alternatives, tests, and cleanup obligations before planning."
      }
    ],
    verification: ["node --test test/runtime-skills.test.mjs", "node --test test/docs.test.mjs", "node --test test/static-workflow-command.test.mjs"]
  },
  {
    id: "refactor",
    title: "Refactor",
    summary:
      "Documents a behavior-preserving restructuring workflow that keeps scope bounded and verifies before/after behavior through OpenCode-visible checks.",
    bindings: [
      {
        kind: "config",
        id: "skills/refactor/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides refactor entry criteria, invariants, red/green verification, diff review, and rollback boundaries."
      },
      {
        kind: "command",
        id: "refactor",
        surface: "OpenCode command /refactor",
        description: "Makes behavior-preserving restructuring directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded refactor mention in chat to the refactor activation prompt instead of the generic lit-loop fallback."
      },
      {
        kind: "agent",
        id: "lit-sentinel/lit-prover",
        surface: "OpenCode review and verification subagents",
        description: "Use independent review and proof lanes when a refactor touches multiple modules or behavior contracts."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "lit-burnoff",
    title: "Lit Burnoff",
    summary:
      "Documents a cleanup workflow for removing AI-like artifacts from code, docs, and prose without changing supported behavior or meaning.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-burnoff/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides cleanup targets, preservation rules, reviewer checks, and no-overwrite safety boundaries."
      },
      {
        kind: "command",
        id: "lit-burnoff",
        surface: "OpenCode command /lit-burnoff",
        description: "Makes the machine-artifact cleanup workflow directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded lit-burnoff mention in chat to the cleanup activation prompt, including the trailing-instruction position."
      },
      {
        kind: "cli",
        id: "npm run scan:legacy-tokens",
        surface: "npm guard command",
        description: "Confirms cleanup wording did not introduce guarded vocabulary before release claims."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs",
      "npm run scan:legacy-tokens"
    ]
  },
  {
    id: "lit-burnoff-file",
    title: "Lit Burnoff File",
    summary:
      "Documents the single-file arm of machine-artifact cleanup, reached from the post-edit hook or an explicit single-file invocation, so one just-edited file is cleaned against its own diff.",
    bindings: [
      {
        kind: "command",
        id: "lit-burnoff-file",
        surface: "OpenCode command /lit-burnoff-file",
        description: "Selects the canonical skill through explicit command or bounded chat activation."
      },
      {
        kind: "config",
        id: "skills/lit-burnoff-file/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the single-file cleanup pass, the diff-scoped review order, and the preservation rules that separate slop from intent."
      },
      {
        kind: "hook",
        id: "tool.execute.after",
        surface: "OpenCode post-edit tool hook",
        description: "Names lit-burnoff-file when exactly one source file was mutated by the host edit or write tool."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/tool-guards.test.mjs"
    ]
  },
  {
    id: "comment-checker",
    title: "Comment Checker",
    summary:
      "Documents the post-edit comment review that judges only the comments this edit added or changed, with no external binary and no separate runner process.",
    bindings: [
      {
        kind: "config",
        id: "skills/comment-checker/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the keep/delete/rewrite decision rules for added comment lines and the boundary that leaves untouched comments alone."
      },
      {
        kind: "hook",
        id: "tool.execute.after",
        surface: "OpenCode post-edit tool hook",
        description: "Names comment-checker when the host edit or write tool mutated a source-extension file."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/tool-guards.test.mjs"
    ]
  },
  {
    id: "lit-code",
    title: "Lit Code",
    summary:
      "Documents minimum-first implementation discipline for OpenCode coding work, including tests, real-surface probes, delegation, and cleanup receipts.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-code/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the coding workflow used by lit-loop and start-work when implementation is in scope."
      },
      {
        kind: "command",
        id: "lit-code",
        surface: "OpenCode command /lit-code",
        description: "Makes minimum-first implementation discipline directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded lit-code mention in chat to the implementation-discipline activation prompt."
      },
      {
        kind: "agent",
        id: "lit-loop/lit-implement",
        surface: "OpenCode implementation agents",
        description: "Apply lit-code guidance while preserving unrelated files and verifying real user-facing behavior."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs",
      "npm test"
    ]
  },
  {
    id: "debugging",
    title: "Debugging",
    summary:
      "Documents hypothesis-first defect investigation: reproduce before theorising, predict an observation before testing it, and prove the mechanism before editing.",
    bindings: [
      {
        kind: "config",
        id: "skills/debugging/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the reproduce/observe/hypothesise/predict/test loop, the bisect ladder, and the rule that a passing test is not a root cause."
      },
      {
        kind: "command",
        id: "debugging",
        surface: "OpenCode command /debugging",
        description: "Makes hypothesis-first defect investigation directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded debugging mention in chat to the investigation activation prompt."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "lit-commit",
    title: "Lit Commit",
    summary:
      "Documents safe git hygiene for OpenCode sessions, including dirty worktree handling, diff review, commits, PRs, and no-release boundaries.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-commit/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides git inspection, staging, commit, branch, and release-boundary guardrails."
      },
      {
        kind: "command",
        id: "lit-commit",
        surface: "OpenCode command /lit-commit",
        description: "Makes git hygiene guidance directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded lit-commit mention in chat to the git hygiene activation prompt."
      },
      {
        kind: "cli",
        id: "git status/git diff/git log",
        surface: "git command-line inspection",
        description: "Use read-only status, diff, and recent-history checks before any requested commit or PR step."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "lsp",
    title: "LSP",
    summary:
      "Documents how to use a language server that the OpenCode host already provides, and states plainly that LitOpenCode bundles no server and starts no daemon.",
    bindings: [
      {
        kind: "config",
        id: "skills/lsp/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the capability probe, the diagnostics-before-edit order, and the boundary that no language server ships with this package."
      },
      {
        kind: "command",
        id: "lsp",
        surface: "OpenCode command /lsp",
        description: "Makes host language-server usage guidance directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded lsp mention in chat to the language-server activation prompt."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "lsp-setup",
    title: "LSP Setup",
    summary:
      "Documents the exact complement of lsp: what to do when no language server is configured for the edited file type, without installing anything silently.",
    bindings: [
      {
        kind: "config",
        id: "skills/lsp-setup/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the unconfigured-extension path: name the gap, offer the host config change, and fall back to compiler or test evidence."
      },
      {
        kind: "command",
        id: "lsp-setup",
        surface: "OpenCode command /lsp-setup",
        description: "Makes the unconfigured-language-server path directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded lsp-setup mention in chat to the language-server configuration activation prompt."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "rules",
    title: "Rules",
    summary:
      "Ships and documents the bounded two-lane repository rules engine for OpenCode sessions, with static and edited-path delivery.",
    bindings: [
      {
        kind: "config",
        id: "skills/rules/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Documents discovery locations, precedence, glob scoping, bounded delivery, and the untrusted repository-data boundary."
      },
      {
        kind: "command",
        id: "rules",
        surface: "OpenCode command /rules",
        description: "Explains the shipped two-lane engine and makes repository rule discovery directly invocable as an installed command alias."
      },
      {
        kind: "hook",
        id: "experimental.chat.system.transform",
        surface: "OpenCode experimental.chat.system.transform hook",
        description: "Delivers repository-wide static rules once per session within the static lane budget."
      },
      {
        kind: "hook",
        id: "tool.execute.after",
        surface: "OpenCode tool.execute.after hook",
        description: "Discovers upward from edited paths and delivers matching glob-scoped dynamic rules within the dynamic lane budget."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "deep-interview",
    title: "Deep Interview",
    summary:
      "Documents the pre-planning interview that converts a broad or underspecified request into a decision-complete brief before lit-plan is allowed to start.",
    bindings: [
      {
        kind: "config",
        id: "skills/deep-interview/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the explore-before-ask rule, the one-fork-per-question rule, the stop condition, and the brief handed to lit-plan."
      },
      {
        kind: "command",
        id: "deep-interview",
        surface: "OpenCode command /deep-interview",
        description: "Makes the pre-planning interview directly invocable as a planning-only installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a bounded deep-interview mention in chat to the pre-planning interview activation prompt."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "browser-drive",
    title: "Browser Drive",
    summary:
      "Documents driving a real page through an external driver behind an identity probe, three named blockers, a snapshot-then-act loop, and an explicit-name-only chat route.",
    bindings: [
      {
        kind: "config",
        id: "skills/browser-drive/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the driver identity probe, the three blocker codes, the snapshot-then-act loop, and the boundary against visual-qa."
      },
      {
        kind: "command",
        id: "browser-drive",
        surface: "OpenCode command /browser-drive",
        description: "Makes page-driving guidance directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes the explicit browser-drive name to its activation prompt, and nothing else: a passing mention of a browser or a URL stays inert."
      }
    ],
    verification: [
      "node --test test/browser-drive.test.mjs",
      "node --test test/runtime-skills.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "structural-search",
    title: "Structural Search",
    summary:
      "Documents syntax-shaped search and rewrite behind an identity probe, a three-state engine verdict, a labeled textual fallback, and a bounded rewrite boundary.",
    bindings: [
      {
        kind: "config",
        id: "skills/structural-search/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the engine identity probe, the structural-versus-semantic split, the labeled fallback, and the four preconditions a rewrite must meet."
      },
      {
        kind: "command",
        id: "structural-search",
        surface: "OpenCode command /structural-search",
        description: "Makes syntax-shaped search guidance directly invocable as an installed OpenCode command alias."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes a search or rewrite verb aimed at a syntax shape to the structural-search activation prompt."
      }
    ],
    verification: [
      "node --test test/runtime-skills.test.mjs",
      "node --test test/docs.test.mjs",
      "node --test test/static-workflow-command.test.mjs"
    ]
  },
  {
    id: "lit-humanizer",
    title: "Lit Humanizer",
    summary:
      "Revises reader-facing prose for its audience and genre while preserving voice, meaning, evidence, citations, and useful qualifiers.",
    bindings: [
      {
        kind: "config",
        id: "litOpenCodeRuntimeSkills",
        surface: "litopencode exported runtime skill catalog",
        description: "Exposes the lit-humanizer skill through the native runtime catalog, prompt route, package assets, and tool guard."
      },
      {
        kind: "command",
        id: "lit-humanizer",
        surface: "OpenCode command /lit-humanizer",
        description: "Provides the canonical prose revision route and loads the installed skill guidance."
      },
      {
        kind: "command",
        id: "tool.execute.before",
        surface: "OpenCode write/edit pre-tool hook",
        description: "Blocks new high-confidence detector hits before supported reader-facing text files are saved."
      },
      {
        kind: "config",
        id: "skills/lit-humanizer/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Provides the full language, format, safety, detector, Office extraction, and verification guidance for native skill users."
      },
      {
        kind: "config",
        id: "rules/bundled-rules/lit-humanizer.md",
        surface: "OpenCode experimental.chat.system.transform hook",
        description: "Applies the compact always-on writing rule on each eligible OpenCode chat turn."
      }
    ],
    verification: ["node --test test/runtime-skills.test.mjs", "node --test test/docs.test.mjs"]
  },
  {
    id: "lit-recap",
    title: "Lit Recap",
    summary:
      "Provides a read-only Korean-default work recap synthesized from the durable LitOpenCode ledger and current session context without writing any state.",
    bindings: [
      {
        kind: "command",
        id: "lit-recap",
        surface: "OpenCode command /lit-recap",
        description: "Injects the static recap template without ledger writes, goal dispatch, or file creation."
      },
      {
        kind: "config",
        id: "skills/lit-recap/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Documents the five-section recap format, brief digest, language switching, and read-only contract."
      }
    ],
    verification: ["node --test test/lit-recap-command.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "lit-comprehend",
    title: "Lit Comprehend",
    summary:
      "Builds a self-contained explainer so the user can understand completed work through delta-anchored themes, diagrams, and interactive examples.",
    bindings: [
      {
        kind: "command",
        id: "lit-comprehend",
        surface: "OpenCode command /lit-comprehend",
        description: "Injects the lit-comprehend methodology and routes to the explainer-building workflow."
      },
      {
        kind: "config",
        id: "skills/lit-comprehend/SKILL.md",
        surface: "LitOpenCode visible static skills corpus",
        description: "Documents the eight-step methodology, canonical sections, verifier contract, and output conventions."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode chat.message activation hook",
        description: "Routes bounded lit-comprehend, comprehend, and $comprehend mentions in chat to the lit-comprehend activation prompt."
      }
    ],
    verification: ["node --test test/comprehend-command.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "lit-handoff",
    title: "Lit Handoff",
    summary: "Provides exact slash and bare-chat handoff activation backed by a package-vendored, hash-verified source contract.",
    bindings: [
      {
        kind: "command",
        id: "lit-handoff",
        surface: "OpenCode command /lit-handoff",
        description: "Injects the exact lit-handoff model probe line, adapter, complete original contract, and resolved template."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode exact bare handoff route",
        description: "Activates only when an entire non-code chat message is handoff."
      },
      {
        kind: "config",
        id: "skills/lit-handoff/SKILL.md",
        surface: "Flat OpenCode native skill wrapper",
        description: "Preserves the adapter and package-vendored exact source, eval, example, and template with hash-aware doctor checks."
      }
    ],
    verification: ["node --test test/lit-handoff.test.mjs", "node --test test/runtime-skills.test.mjs"]
  },
  {
    id: "lit-scientific-visualization",
    title: "Scientific Visualization",
    summary: "Provides exact slash and bare-chat OpenCode routes to the complete publication-figure corpus with vendor integrity, dependency reporting, and a harness-rendered session mark and model-emitted probe line.",
    bindings: [
      {
        kind: "command",
        id: "lit-scientific-visualization",
        surface: "OpenCode command /lit-scientific-visualization",
        description: "Injects the exact model probe line and resolves scripts, assets, references, tests, and styles from the native skill root."
      },
      {
        kind: "hook",
        id: "chat.message",
        surface: "OpenCode exact bare lit-scientific-visualization route",
        description: "Activates only when an entire non-code chat message is the exact skill id."
      },
      {
        kind: "hook",
        id: "experimental.text.complete",
        surface: "OpenCode user-facing completion hook",
        description: "Renders the standard mark on the first session completion and micro marks later, keeping the model-emitted probe separate."
      },
      {
        kind: "config",
        id: "skills/lit-scientific-visualization/SKILL.md",
        surface: "Flat OpenCode native skill wrapper",
        description: "Ships the exact 16-file authored payload in vendor/ plus adapter license, provenance, and notice."
      },
      {
        kind: "cli",
        id: "litopencode doctor",
        surface: "LitOpenCode dependency and payload doctor",
        description: "Reports hash integrity independently from READY or DEGRADED Python capability without installing dependencies."
      }
    ],
    verification: ["node --test test/lit-scientific-visualization.test.mjs", "npm run check:pack-payload"]
  },
  {
    id: "lit-diagram-drawer",
    title: "Diagram Drawer",
    summary: "Installs an OpenCode native skill with pinned diagram guides, templates, local verifiers, safe importers, and an exporter that never installs dependencies.",
    bindings: [
      {
        kind: "config",
        id: "skills/lit-diagram-drawer/SKILL.md",
        surface: "OpenCode native skill picker",
        description: "Selects the bounded diagram workflow and its complete managed skill tree. Bounded lit diagram requests direct the model to this native picker; no dedicated slash or standalone diagram chat route is registered."
      },
      {
        kind: "cli",
        id: "litopencode install",
        surface: "LitOpenCode managed native skill installer",
        description: "Installs every hash-pinned guide, template, example, tool, font, and license asset."
      },
      {
        kind: "cli",
        id: "litopencode doctor",
        surface: "LitOpenCode managed native skill doctor",
        description: "Verifies the exact installed file closure and reports export capabilities without installing tools."
      }
    ],
    verification: ["node --test test/lit-diagram-drawer.test.mjs", "npm run check:managed-skill-manifest", "npm run check:pack-payload"]
  },
  {
    id: "lit-typographic-motion",
    title: "Film director",
    summary: "Native OpenCode film director: treatment first, a captured stage page or the type engine, generated sound, a numeric gate and recorded look rounds.",
    bindings: [
      { kind: "config", id: "skills/lit-typographic-motion/SKILL.md", surface: "OpenCode native skill picker", description: "Loads the managed motion skill and its engine and reference closure." },
      { kind: "hook", id: "lit-task motion-video intent", surface: "OpenCode chat.message activation", description: "Routes bounded film requests before slide and interface guidance with a neutral film context." },
      { kind: "hook", id: "tool.execute.after", surface: "OpenCode tool.execute.after hook", description: "Records each read of a film's stills so the done check can confirm the frames were viewed." },
      { kind: "cli", id: "litopencode motion-runtime install|status", surface: "LitOpenCode runtime", description: "Pre-warms pinned dependencies and fonts outside the render session." },
      { kind: "cli", id: "litopencode doctor", surface: "LitOpenCode doctor", description: "Reports Chrome, ffmpeg, WebGL2 tier, software warning, and pre-warm status." }
    ],
    verification: ["node --test test/lit-typographic-motion.test.mjs", "npm run check:managed-skill-manifest", "npm run check:pack-payload"]
  },
  {
    id: "lit-pptx",
    title: "Lit PowerPoint",
    summary: "Native OpenCode deck skill with source, compile, QA, fonts, and first-use dependency cache.",
    bindings: [
      { kind: "config", id: "skills/lit-pptx/SKILL.md", surface: "OpenCode native skill picker", description: "Loads the slide workflow from the installed managed tree." },
      { kind: "hook", id: "lit-task slide intent", surface: "OpenCode chat.message activation", description: "Directs bounded lit slide requests to the native skill." },
      { kind: "cli", id: "litopencode doctor", surface: "LitOpenCode doctor", description: "Reports installed skill integrity and office runtime readiness." }
    ],
    verification: ["node --test test/lit-office-docs.test.mjs", "npm run check:pack-payload"]
  },
  {
    id: "lit-docx",
    title: "Lit Word Documents",
    summary: "Native OpenCode document skill with publisher profiles, conversion, editing, lint, and first-use dependency cache.",
    bindings: [
      { kind: "config", id: "skills/lit-docx/SKILL.md", surface: "OpenCode native skill picker", description: "Loads the document workflow from the installed managed tree." },
      { kind: "hook", id: "lit-task report intent", surface: "OpenCode chat.message activation", description: "Directs bounded lit report requests to the native skill." },
      { kind: "cli", id: "litopencode doctor", surface: "LitOpenCode doctor", description: "Reports installed skill integrity and office runtime readiness." }
    ],
    verification: ["node --test test/lit-office-docs.test.mjs", "npm run check:pack-payload"]
  },
  frontendUiUxFeature,
  {
    id: "readme-studio", title: "README Studio",
    summary: "Native-installed README production, safe local typography and portable motion assets.",
    bindings: [
      { kind: "config", id: "skills/readme-studio/SKILL.md", surface: "OpenCode native skill readme-studio", description: "Loads fact discovery, capability branches and task-local composition recipes." },
      { kind: "cli", id: "litopencode install", surface: "LitOpenCode native skill installer", description: "Copies all hash-pinned nested resources." },
      { kind: "cli", id: "litopencode doctor", surface: "LitOpenCode native skill doctor", description: "Rejects missing or altered resources." }
    ],
    verification: ["node --test test/runtime-skills.test.mjs test/cli-install-surface.test.mjs test/packed-artifact.test.mjs", "npm run check:managed-skill-manifest"]
  },
  visualQaFeature
] satisfies readonly LitOpenCodeFeature[]);

export function findLitOpenCodeFeature(id: string): LitOpenCodeFeature | undefined {
  return litOpenCodeFeatures.find((feature) => feature.id === id);
}
