# Changelog

Notable user-visible changes are recorded here. Registry and Git release operations
are tracked separately from this product history.

## Unreleased

## 1.0.11 - 2026-09-29

- The motion skill's runtime now installs `ws` 8.22.0 instead of 8.18.3, which fixes a memory-exhaustion denial of service and an uninitialized-memory disclosure in that package. After upgrading, run `litopencode motion-runtime install` again so the cache picks up the new version.
- Two Wikify captures running at the same moment no longer fail with a blocked store error when one of them releases its lock while the other is checking it. The waiting capture now retries.
- A Lit slash command now shows the `🔥 LIT IGNITED` toast once. Before, the same toast appeared twice, with the second one replacing the first.
- The Jev debug trace (`LITOPENCODE_JEV_TRACE=1`) now also refuses a symlinked `.litopencode` or `.litopencode/logs` folder. It writes nothing and the turn continues normally.

## 1.0.10 - 2026-09-28

- Add an optional Jev skill hint. It is off by default. With `LITOPENCODE_JEV=1` and your own `TYPESAFE_API_KEY` set, an eligible chat turn gets one advisory line naming a LitOpenCode skill. The model still decides whether to load it.
- When the hint is on, each eligible prompt is sent to TypeSafe. Home paths, e-mail addresses, `password=`-style assignments and other token-shaped strings are replaced first, and the prompt is then cut to 2,000 characters. Files, tool output and earlier turns are not sent. Slash commands and child sessions are skipped.
- While the hint is on, a `✦ Jev skill hint is ON` toast shows once per session, and a turn that gets a hint shows a short toast such as `Jev → lit-humanizer (0.27s)`. `litopencode doctor` reports whether the hint is off, on, or missing its key.
- The hint reaches the model but is not shown or copied as your own words. A redirected Jev request is refused, and the debug trace never writes through a symlink.
- A skill started with a slash command now stays active in a running OpenCode. Before, it was cleared when the command's message arrived.

## 1.0.9 - 2026-09-28

- The repository no longer carries maintainer-only release tooling, and the package no longer ships it.

## 1.0.8 - 2026-09-28

- Add `lit-humanizer`, which replaces `lit-korean`. It brings an always-on writing rule, a packaged detector, and a pre-write guard for new reader-facing text. `/lit-korean` and the other former Korean prose routes keep working as aliases.
- Add `lit-pptx` for editable PowerPoint decks built from a Markdown slide source, and `lit-docx` for styled Word reports and manuscripts. A bare `lit` request for slides or a report loads the matching skill. Decks are checked against measured slide rules, and reports get a line-length and number-alignment audit.
- Add `lit-diagram-drawer` with 61 type guides, 183 templates, local verification, bounded diagram import, and export checks that need no installs. A bounded diagram request with `lit` loads it before drawing; ordinary work, UI requests, quoted text, and planning are unchanged.
- Give `frontend-ui-ux` build, polish, audit, and harden modes, a craft floor, a list of common interface faults, and a measured interface probe that checks the finished page in a browser. Motion guidance is now part of its routed references.
- Add `lit-typographic-motion`, which directs a film from a written treatment. Films that show things render a stage page frame by frame; films made of words take the type path. Each film gets a generated sound bed and is not done until its look rounds are recorded on the final frames.
- `browser-drive` accepts `agent-browser` 0.34.0 and newer, and shows the manual setup and a first-run check when the driver is missing.
- Replace the two README covers with one looping motion cover: the five robots power on in turn and the LitOpenCode robot wakes. The reduced-motion still shows the fully lit frame.
- Show the README A/B results as final verdicts for ten tasks with pictures of both sides, and add a skill table with a snapshot, routes, and a one-line summary for each user-facing skill, in English and Korean.
- A plain `lit` request for a self-contained task now works on it directly, without a durable plan, goal ledger, or delegation. `lit loop` or a request for long, multi-turn work still starts the full loop.
- `lit` prompts sent through `opencode run` now activate the same way as typed ones.
- `litresearch` version comparisons pair each dimension across the named versions and state a concrete migration effect.

## 1.0.7

- Run the automatic update's staged installer on Node instead of the OpenCode host binary, so a new release no longer rolls back and leaves the plugin unloaded.
- Keep `~/.litopencode/` owner-only instead of refusing a directory created world-readable by earlier state writers, and load the current install when the state directory is unusable.

## 1.0.6

- Ask about competing visual directions the brief leaves open instead of silently applying an announced default.
- Show the link target, its resolved directory, and any same-named shadowing skill for the shared native skills root in install and doctor output.
- Show the robot cover as a visible image under the motion hero in both READMEs instead of behind a hidden link, and remove the duplicate copy that repeated near the LITFAMILY illustration.

## 1.0.5

- Add README Studio decoration patterns and the bounded multi-round design interview.
- Default fresh OpenAI-provider installs to GPT-6 Astra for planning and review and GPT-6 Luna for execution and research, with GPT-6 Sol available as a coding-lead option.
- Align the bilingual READMEs with the family layout and pin npm-rendered package links and images to this release.

## 1.0.4

- Remove the repeated discipline label from completion marks so the model's bold ignition line appears once.

## 1.0.3

- Replace the activation probe with a bold LIT ignition line; show a color-free six-second warning toast with the micro mark and discipline label when mark glyphs are supported, and use the label alone otherwise.

## 1.0.2

- Add an animated README cover with a static image for reduced-motion settings.
- Remove automatic skill review because it never completed a review in practice. Existing `.lit*/pending-review.json` and `skill-loop-state.json` files are inert and may be deleted; no other state is affected.
- Make `npm publish` refuse to proceed when the test suite fails.
- Remove private checkout paths from the `lit-plan` example and two contract examples.

## 1.0.1

- Remove the runtime host-plugin dependency chain from consumer installs. LitOpenCode now ships
  its own `zod@4.1.8` tool schema helper, so Node 22.22.0 installs no longer warn or fail strict
  engine checks on transitive `effect`/`ini` packages while OpenCode tool registration remains intact.

## 1.0.0

- Prepare `@litfamily/litopencode` for independent OpenCode installation. The executable,
  native plugin ID, configuration paths, and ownership markers remain `litopencode`.
- Migrate published-package and prior package registrations while preserving tuple
  options, authored routes, and user-owned files. Update checks validate the exact scoped
  package identity before suggesting or staging a newer stable version.
- Keep planning agents read-only, permission changes explicit, and workflow evidence local.
  Ship the reader-facing communication contract and canonical skill routes with compatibility aliases.
- Align bilingual installation, safety, removal, community, and privacy guidance with the
  scoped package. Apply the Ignition vector cover and keep installation commands as editable
  README text. Align the terminal mark with the approved interlocking Ignition symbol
  and its orange, lime, and ivory palette.
- Preserve unattended installer behavior and terminal fallbacks. Covers and maintainer-only
  materials remain outside the npm payload; native runtime and managed skill resources stay packaged.

## 0.2.7 - 2026-09-03

- Add one advisory reader-facing communication contract to the effective OpenCode system,
  activation, and agent prompts so routine operational metadata stays out of default replies while
  material failures, risks, and required actions remain visible.
- Keep `reader`, `technical`, and `audit` request-scoped, and require parent agents to filter child
  reports without reducing internal DoneClaims, verification, evidence, ledgers, or handoff detail.
- Add regression and package-parity coverage for prompt injection, compaction, delegation, handoff,
  structured output, and explicit-detail overrides.
- Make JSON version lockstep count only the package identity fields, so dependency metadata that
  happens to match the release version cannot block a valid bump.

## 0.2.6 - 2026-09-02

- Move vendored handoff and scientific-visualization corpora to `vendor/` with
  thin skill wrappers remaining in the skill paths.
- Count vendor license, provenance, and NOTICE companions in family
  payload-parity so packed skills keep the material they name.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.5 - 2026-09-02

- Hardened inode-reuse checks across skill-loop roots, runtime and anchored-worker file operations,
  knowledge state, observer logs/locks, and Autoresearch/Autoconference publication. Stable stat
  identity now carries device/inode plus ctime and birthtime (directory checks use birthtime), with
  regular-file link-count checks at descriptor and cleanup boundaries.
- Bound trusted review launchers and shebang interpreters to SHA-256 bytes read through `O_NOFOLLOW`
  descriptors and verified before and after use; failed observer lock creation now retires and
  rechecks the lock before removal, and only cooperative parent races are retried.
- Added eight inode-reuse simulations covering launcher, directory/file, anchored worker, knowledge,
  lock, observer cleanup, and publication paths; regenerated managed-skill hashes.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.4 - 2026-09-01

- Added the stacked LitFamily ASCII wordmark to the LitOpenCode CLI and both English and Korean
  README landing pages; the wordmark remains version-free.
- Made interactive terminal installs show the model route picker by default, with the current
  managed lead and helper routes pre-selected. `--yes`, `--no-model-prompt`, dry-run, and
  non-interactive paths retain their existing behavior.
- Extended version lockstep coverage to every registered version-bearing file, counting both
  literal and escaped-regex spellings, and added repository registry tests.
- Wired the credential-free behavior-replacement, installed-resource-tamper, negative-gate,
  rules-glob-differential, and Wikify surface QA layers into CI with named exclusions for the
  composite probe to avoid duplicate work.
- Kept local OpenCode runtime state out of tracked files. This is a local release candidate only;
  no publish, tag, or push was performed.

## 0.2.3 - 2026-08-31

- Added packed-payload substance, cross-product parity, and referenced-path checks
  so installed OpenCode skills retain the material they name.
- Refreshed the canonical legal attribution metadata without changing the four
  upstream attributions it records. This is a local release candidate only; no
  publish, tag, or push was performed.

## 0.2.2 - 2026-08-30

- Added installer model/provider choice with separate lead and helper routes,
  including `-fast` model-id normalisation so the lead upgrade applies to
  `lit-loop`, `momus`, and `litwork-reviewer` defaults.
- Routed the review child through the configured provider credential descriptor,
  added a symlink-safe host auth-store read, and retained bounded proposal-only
  review behavior.
- Kept the plan-file gate and Windows fail-closed learning-loop boundary visible
  in the OpenCode docs and runtime surfaces.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.1 - 2026-08-29

- Added the OpenCode-native skill learning loop: user-invoked review or validated proposal import
  creates pending records, and only an explicit foreground `skill-loop apply` can write an
  agent-marked skill under the OpenCode user skill root. Shipped, installer-managed, unmarked,
  symlinked, secret-bearing, and non-portable targets fail closed.
- Added strict proposal and decision-ledger readers, content-addressed apply/rollback receipts, a
  usage sidecar, deterministic user-invoked curator transitions, and bounded `tool.execute.after`
  counter/noticing without hook-triggered model calls or automatic application.
- Enrolled the expanded Skill Observer and its byte-pinned review contract in the managed install
  and package surfaces. Prepared package, lockfile, README, release-checklist, and release-fixture
  version surfaces at `0.2.1`; this entry does not imply publication, tagging, or a remote release.
- Hardened review-host pinning, bounded current-skill context, transaction recovery, and root-anchored
  mutations. Review, user-skill mutation, rollback, and curator operations now fail closed on Windows
  with `WINDOWS_SKILL_LOOP_UNSUPPORTED` until native handle and ACL support is available; passive and
  project-local proposal surfaces remain available.

## 0.2.0 - 2026-08-27

- Added a standalone output-channel declaration across the 41-skill corpus, with the two
  activation-byte-budgeted UI/UX contracts declaring from their reachable
  `references/complete-contract.md` files. A structural documentation gate now rejects missing
  declarations, unknown artifact genres, and genre/channel mismatches.
- Added a deliverable hedge guard to OpenCode's `tool.execute.after` surface. That event can inspect
  bounded text carried by native `write` and `edit` inputs, so the guard appends a
  model-visible, genre-aware advisory without reopening an artifact path or replacing the successful
  tool result. Unknown, path-only, and oversized input shapes fail open. The guard reads the active
  skill's declaration rather than hardcoding an artifact genre.
- Kept the behavioral claim narrow: two isolated A/B runs found no measurable improvement from the
  contract prose alone. The declaration is machine-readable metadata consumed by the guard; this
  release claims that the guard flags qualifying hedges, not that the prose makes the model write a
  cleaner document.
- Bumped to `0.2.0` because the corpus-wide contract and new runtime hook are a new product surface,
  rather than another maintenance increment within the `0.1.x` line.

## 0.1.70 - 2026-08-26

- Aligned the package, lockfile, README surfaces, release checklist, and
  release fixtures at `0.1.70` for G20 slice 19.

## 0.1.69 - 2026-08-23

- Added the `frontend-ui-ux` taste dials, `browser-drive`, and `skill-observer`
  workflow surfaces with managed package coverage.
- Kept package, lockfile, README surfaces, and release-fixture versions aligned at `0.1.69`.

## 0.1.68 - 2026-08-15

- Simplified the English and Korean README surfaces and pinned the packaged
  cover link to the exact release version.
- Kept package, lockfile, and release-fixture versions aligned at `0.1.68`.

## 0.1.67 - 2026-08-14

- Added provider-free activation and cache measurement contracts with packed
  consumer coverage and deterministic lock-race handling.

## 0.1.66 - 2026-08-12

- Added advisory evidence review guidance to the `frontend-ui-ux` skill.
- Added managed-skill manifest and documentation coverage for the guidance.

## 0.1.65 - 2026-08-11

- Added project-local Wikify knowledge capture, review, save, query, and status flows. Structured
  events remain `review-needed` until an explicit review changes their state. Queries return only
  accepted records with bounded deterministic output, provenance, and `claims.jsonl` as the sole authority.
- Hardened the knowledge store against lock and publication races. Concurrent duplicate writers converge
  on one record. Lock-owner disappearance, authority replacement, staged writes, atomic renames, and
  recovery boundaries fail closed without false success results.

## 0.1.64 - 2026-08-09

- Added a default-on foreground update barrier at plugin startup for eligible
  interactive lifecycle paths. It pins an exact stable package, uses a
  credential-free npm environment and transaction lock, verifies with doctor,
  and records rollback/unknown-state receipts before exposing hooks.
- Kept the detached notifier cache-only and added explicit opt-outs for users
  who want advisory checks without automatic installation.

## 0.1.63 - 2026-08-06

- Added `outputStyle` config field (`off | asd-ste100 | asd-ste100-ko | eli5 | eli5-ko`) that injects
  a style instruction into the system prompt after repository rules. The install prompt offers a
  five-choice menu (default: keep current / off). Validated in the config parser; fails open with no
  push when the file is missing or the style is `off`.

## 0.1.62 - 2026-08-05

- Re-routed the shipped agent default from `gpt-5.6-sol`/`high` (with `gpt-5.6-terra`/`xhigh` for
  `lit-explorer` and `lit-librarian`) to `gpt-5.6-luna`/`max` for every shipped agent, following
  price/performance data showing Luna at max effort matches Sol at high effort on pass rate at
  roughly a quarter of the cost. The interactive picker now offers only LUNA, and the effort floor
  moved with it: below-high Luna effort is rejected the same way below-high TERRA effort was
  before.

## 0.1.61 - 2026-08-04

- Added one exact chat-safe checklist grammar for `lit-plan`: consecutive column-zero rows under
  `## TODOs` carry concrete Action, Output, and Verification fields, and rows under
  `## Final verification` carry concrete Verification fields. The planning agent, `/lit-plan`
  command hook, installed skill, and optional scaffolder expose that shape, while `/start-work`
  remains separately routed to `lit-implement` and `lit-plan` retains its edit, bash, task, and write
  denials.
- Made the optional file-backed checker require active concrete rows, reject placeholder, blank,
  malformed-marker, misnumbered, and completed-only handoffs, including exact case-insensitive
  `TBD`/`TODO` and ellipsis-only fields, and exclude fenced, nested, indented, and incidental decoys.
  `managed-skill-manifest.json` coverage and the focused regression were updated with the contract.

## 0.1.60 - 2026-08-02

- Fixed the `frontend-ui-ux` CLI entrypoint guard, which compared an unresolved `process.argv[1]`
  against `import.meta.url`. Reached through a symlink — which is how an installed skills root
  reaches it — the CLI never ran: an invalid design contract and an unknown subcommand both exited 0
  with empty output, voiding the 0/1/2 contract the file's own header declares. Both sides are now
  resolved with `realpathSync`.
- Gave the `frontend-ui-ux` JSON trust layer machine-readable error codes. `strict-json`,
  `bounded-json`, `stdin-json`, and `uiux` threw bare `Error`/`TypeError`, so a caller could not tell
  a malformed payload from an unusable file from a bad argument without matching on prose. They now
  raise a `ContractError` carrying `JSON_INVALID`, `FILE_INVALID`, or `ARGUMENT_INVALID`, with
  `DESIGN_CONTRACT_INVALID` available to callers. Exit codes are unchanged.
- Added a language server catalog to `lsp-setup`. The skill's method asks which extension is
  unserved but shipped nothing that could answer it. `references/` now maps 20 languages to their
  server, install cost, alternatives, the failure modes that produce confidently wrong diagnostics,
  and the fallback to use while a file stays unserved.
- Added runtime, escalation, and tool references to `debugging`: how to obtain a real observation in
  Node, Python, Go, Rust, a compiled binary without source, and a bundled JS executable; the
  two-dead-rounds reframe; and the specialist tools for symptoms ordinary instrumentation cannot see.
- Added per-language references to `programming` for Go, Python, Rust, and TypeScript, covering type
  patterns, failure handling, concurrency, testing, and strict tooling configuration. These are
  defaults for new code — the surrounding project's conventions still win.

## 0.1.59 - 2026-08-02

- Added the `lit-comprehend` runtime skill and `/lit-comprehend` command for when understanding,
  not status, is the bottleneck: after a long agent session it builds one self-contained explainer
  artifact a person can reason with, rather than the chronology `lit-recap` already provides. It
  anchors on what the reader already knew, orders the walkthrough conceptually instead of by file,
  ships an interactive micro-world, discloses what is not verified, and closes with a quiz framed
  as a speed regulator.
- Gated execution rather than narrowing activation: being invoked is not permission to build. An
  invocation naming a path or git range proceeds; a bare invocation or a prose question gets a
  one-screen scope proposal (target, exclusions, estimate) and waits for approval, with the
  cheaper one-sentence answer offered when the request deserves it. The proposal is derived from
  `git status`, `git diff --stat`, and durable state, never by reading the tree.
- Bundled `scripts/verify-explainer.ts`, an HTML scaffold, and authoring references. The verifier
  fails an artifact for a phantom code quote, a quote attributed to a missing file, code quoted
  with no attribution, an external resource reference, a missing canonical section, an artifact
  written inside the worktree, a quiz option without feedback, a positional tell, collapsed code
  blocks, and ASCII-art diagrams.
- Routing accepts `lit-comprehend`, bare `comprehend`, and `lit comprehend`; `comprehension`,
  `incomprehensible`, `설명해줘`, `이해가 안 돼요`, and `explain this function to me` are proven
  by negative-control tests not to activate.

## 0.1.58 - 2026-07-30

- Fixed `lit`/`litwork`/`start-work`/`review-work` status reads crashing with a ledger parse error
  when the workspace's append-only ledger contains legacy events (for example an `event` key
  instead of `type`). Status now uses a lenient read that skips invalid lines and reports a bounded
  diagnostic; strict parsing is unchanged for writes, recovery, and the bounded-authority lifecycle.
- Moved the CI dry-pack report outside the package root so the guard never scans its own report,
  and rejected non-finite `run_with_deadline.py` seconds as typed CLI input errors.

## 0.1.57 - 2026-07-29

- Added the exact verified 167-file canonical frontend reference library as an inert, separately
  managed corpus while preserving the existing normalized retrieval dataset.
- Added one managed Autoresearch family with ten nested modes, one managed Autoconference family with
  seven nested modes and fail-closed task capability, and one managed Wikify family with five nested
  modes and five templates.
- Added hyphen-native family command aliases and bounded leading chat activation without adding tools,
  agents, MCP servers, daemons, publication actions, or live-profile mutation.
- Replaced cumulative README release chronology with current supported behavior and replayable gates.

For earlier versions, use the repository tags and commit history together with the release checklist;
those are authoritative for the exact source and verification state of each release.
