# LitOpenCode Release Checklist

This checklist is a readiness gate, not an instruction to distribute. The current CI and local workflow are no-publication by default.

The current removal candidate has retired the Skill Observer and skill-learning CLI routes. Existing
project-local learning records are inert and may be deleted; no other state is affected. Installed
users need a patch release to stop receiving the old behavior.

## 1.0.13 Release Scope

- The GitHub pages (English and Korean) now show what Jev looks like: the `litopencode doctor` line and the toasts when Jev is off, on, or missing its key. Jev stays off unless you turn it on, and the reference lists what each toast says.
- The GitHub pages gained a short motion film that follows one `lit` prompt from request to record.
- The package no longer carries the Jev pictures and the film, which only the GitHub pages show, so the download is about 1.8 MB smaller.

## 1.0.12 Release Scope

- The npm page is a short install card that links to the full guide on GitHub.
- The English and Korean READMEs and the npm card were rewritten in plainer language, with the reason given before each switch.

## 1.0.11 Release Scope

- The motion skill's runtime now installs `ws` 8.22.0 instead of 8.18.3, which fixes a memory-exhaustion denial of service and an uninitialized-memory disclosure in that package. After upgrading, run `litopencode motion-runtime install` again so the cache picks up the new version.
- Two Wikify captures running at the same moment no longer fail with a blocked store error when one of them releases its lock while the other is checking it. The waiting capture now retries.
- A Lit slash command now shows the `🔥 LIT IGNITED` toast once. Before, the same toast appeared twice, with the second one replacing the first.
- The Jev debug trace (`LITOPENCODE_JEV_TRACE=1`) now also refuses a symlinked `.litopencode` or `.litopencode/logs` folder. It writes nothing and the turn continues normally.

## 1.0.10 Release Scope

- Add an optional Jev skill hint. It is off by default. With `LITOPENCODE_JEV=1` and your own `TYPESAFE_API_KEY` set, an eligible chat turn gets one advisory line naming a LitOpenCode skill. The model still decides whether to load it.
- When the hint is on, each eligible prompt is sent to TypeSafe. Home paths, e-mail addresses, `password=`-style assignments and other token-shaped strings are replaced first, and the prompt is then cut to 2,000 characters. Files, tool output and earlier turns are not sent. Slash commands and child sessions are skipped.
- While the hint is on, a `✦ Jev skill hint is ON` toast shows once per session, and a turn that gets a hint shows a short toast such as `Jev → lit-humanizer (0.27s)`. `litopencode doctor` reports whether the hint is off, on, or missing its key.
- The hint reaches the model but is not shown or copied as your own words. A redirected Jev request is refused, and the debug trace never writes through a symlink.
- A skill started with a slash command now stays active in a running OpenCode. Before, it was cleared when the command's message arrived.

## 1.0.9 Release Scope

- The repository no longer carries maintainer-only release tooling, and the package no longer ships it.

## 1.0.8 Release Scope

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

## 1.0.7 Release Scope

- Run the automatic update's staged installer on Node instead of the OpenCode host binary, so a new release no longer rolls back and leaves the plugin unloaded.
- Keep `~/.litopencode/` owner-only instead of refusing a directory created world-readable by earlier state writers, and load the current install when the state directory is unusable.

## 1.0.6 Release Scope

- Ask about competing visual directions the brief leaves open instead of silently applying an announced default.
- Show the link target, its resolved directory, and any same-named shadowing skill for the shared native skills root in install and doctor output.
- Show the robot cover as a visible image under the motion hero in both READMEs instead of behind a hidden link, and remove the duplicate copy that repeated near the LITFAMILY illustration.

## 1.0.5 Release Scope

- Add README Studio decoration patterns and the bounded multi-round design interview.
- Default fresh OpenAI-provider installs to GPT-6 Astra for planning and review and GPT-6 Luna for execution and research, with GPT-6 Sol available as a coding-lead option.
- Align both READMEs with the family layout and pin npm-rendered package links to this release.

## 1.0.4 Release Scope

- Remove the repeated discipline label from completion marks so the model's bold ignition line appears once.

## 1.0.3 Release Scope

- Replace the activation probe with a bold LIT ignition line; show a color-free six-second warning toast with the micro mark and discipline label when mark glyphs are supported, and use the label alone otherwise.

## 1.0.2 Release Scope

- Ship the animated README cover with a static fallback for reduced-motion settings.
- Remove automatic skill review, which never completed a review in practice, and clarify that its
  leftover state files are inert and may be deleted without affecting other state.
- Refuse npm publication when the test suite fails.
- Remove private checkout paths from the `lit-plan` example and two contract examples.

## 1.0.1 Release Scope

- Remove the runtime `@opencode-ai/plugin` dependency chain from consumer installs by using
  the direct `zod` schema helper while retaining the host package for development-time types.
- Prove plain and engine-strict packed consumer installs on Node 22.22.0 resolve no `effect` or
  `ini` packages, and confirm the real OpenCode host registers and calls a LitOpenCode tool schema.

## 1.0.0 Release Scope

- Prepare the unpublished `@litfamily/litopencode` candidate with native binary, plugin,
  configuration, and ownership identities preserved.
- Verify original published-name and prior full-name candidate migrations into this version,
  including repeat installation, doctor, native hooks, removal, and refusal controls.
- Match the bilingual README SVG and WebP fallback to the current Ignition vector exports
  and preserve canonical ASCII.
- Publication, tags, pushes, and remote setup remain separately gated.

## 0.2.7 Release Scope

- Ship the advisory reader-facing communication contract through the native OpenCode prompt and
  rule paths, with default `reader` replies filtering routine operational metadata while preserving
  material failures, risks, and required actions.
- Keep `reader`, `technical`, and `audit` request-scoped, and filter child reports at the parent
  boundary without reducing internal verification, evidence, ledgers, or detailed handoffs.
- Cover prompt injection, compaction, delegation, handoff, structured output, and explicit-detail
  overrides in regression and packed-payload gates.
- Count only package identity fields for JSON version lockstep so matching dependency metadata does
  not create a false release blocker.

## 0.2.6 Release Scope

- Move vendored handoff and scientific-visualization corpora to `vendor/` with thin skill
  wrappers remaining in the skill paths.
- Count vendor license, provenance, and NOTICE companions in family payload-parity so packed
  skills keep the material they name.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.1 Release Scope

- Keep the CLI command inventory, managed-skill manifest, and installer payload aligned with
  shipped surfaces.
- Verify documented OpenCode config, command, and tool routes through isolated host probes.
- Keep runtime state and agent-owned user files outside the package payload.
- Keep package, lockfile, English and Korean README surfaces, and release fixtures aligned at `0.2.1`.

## 0.2.0 Release Scope

- Declare `artifact_genre` and its matching `limitations_channel` across the entire top-level skill corpus,
  keeping the byte-budgeted UI/UX declarations in their reachable complete-contract references.
- Enforce the declaration shape and genre-to-channel mapping through the documentation gate.
- Use the active skill declaration as machine-readable metadata for the `tool.execute.after`
  deliverable hedge guard. The after-hook scans only bounded text carried by recognized native
  write/edit inputs and appends model-visible advisory context without reopening an artifact
  path or replacing the host tool result. Unknown, path-only, and oversized inputs fail open.
- Record the validation limit honestly: two isolated A/B runs found no measurable document-quality
  improvement from contract prose alone. The runtime claim is the guard's genre-aware finding, not
  that the declaration persuades the model to write cleaner prose.
- Keep package, lockfile, English and Korean README surfaces, and release fixtures aligned at `0.2.0`.

## 0.1.70 Release Scope

- Keep package, lockfile, README surfaces, and release-fixture versions aligned at `0.1.70`.

## 0.1.69 Release Scope

- Ship the `frontend-ui-ux` taste dials and `browser-drive` surfaces with managed package coverage.
- Keep package, lockfile, README surfaces, and release-fixture versions aligned at `0.1.69`.

## 0.1.68 Release Scope

- Keep the bilingual README entry paths and repository-owned cover links aligned.
  Heavy covers, their generator, and this maintainer checklist stay out of npm.
- Keep the package and lockfile release metadata aligned at `0.1.68`.

## 0.1.67 Release Scope

- Ship advisory evidence review guidance through the managed `frontend-ui-ux` skill.
- Keep the manifest hash and documentation coverage aligned with the packaged skill.

## 0.1.65 Release Scope

- Ship project-local Wikify knowledge capture and explicit review states. Keep `claims.jsonl` as the
  sole local authority, query accepted records only, and preserve bounded deterministic output with provenance.
- Harden knowledge mutations against concurrent writers, lock-owner races, authority replacement, staged
  publication failures, and interrupted recovery without reporting false save success.

## 0.1.62 Release Scope

This versioned section records the 0.1.62 scope only; it does not describe current model defaults. See the current GPT-6 policy in `docs/reference.md` and the active preflight below.

- Re-route every shipped agent default from the prior role-split SOL/TERRA pair to a
  single `gpt-5.6-luna`/`max` route, offering only LUNA in the interactive picker.
- Re-aim the effort-floor guard from TERRA to LUNA: below-high Luna effort and conflicting Luna
  effort fields fail closed the same way TERRA's did, without silently substituting another model.
- Update README, migration docs, and the `agent-roster`/`doctor-installer`/`start-work` skills to
  describe the LUNA-only route; confirm `check:managed-skill-manifest` passes unchanged (no vendored
  skill payload touched).

## 0.1.61 Release Scope

- Make `lit-plan` report the exact chat-safe `## TODOs` and `## Final verification` checklist
  grammar, with consecutive column-zero implementation rows carrying concrete Action, Output, and
  Verification fields and F rows carrying concrete Verification fields.
- Tighten the optional file-backed checker to reject placeholder, blank, malformed-marker,
  misnumbered, or completed-only active rows, including exact case-insensitive `TBD`/`TODO` and
  ellipsis-only fields, while excluding fenced, nested, indented, and incidental decoy rows.
- Expose the checklist contract through the planning agent, `/lit-plan` command hook, installed skill,
  and optional scaffolder without relaxing `lit-plan`'s planning-only permissions. Separately prove
  that `/start-work` remains routed to `lit-implement`; do not describe that route assertion as an
  exercised plan transfer. Keep `managed-skill-manifest.json` and the focused regression current.

## 0.1.60 Release Scope

- Resolve symlinks on both sides of the `frontend-ui-ux` CLI entrypoint guard. Reached through a
  symlinked skills root the CLI never ran, so an invalid design contract and an unknown subcommand
  both exited 0 with empty output instead of 1 and 2.
- Give the `frontend-ui-ux` JSON trust layer a `ContractError` carrying `JSON_INVALID`,
  `FILE_INVALID`, and `ARGUMENT_INVALID`, with `DESIGN_CONTRACT_INVALID` available to callers, so
  failures within the exit-2 trust class are distinguishable without matching on prose.
- Add reference trees the three doctrine-only skills were missing: a 20-language server catalog for
  `lsp-setup`, runtime/escalation/tool notes for `debugging`, and per-language guidance for
  `lit-code` covering Go, Python, Rust, and TypeScript. Each tree is routed from its skill body
  and covered by a reachability test, so no entry ships as an orphaned document.

## 0.1.59 Release Scope

- Add the `lit-comprehend` runtime skill and `/lit-comprehend` command, enrolled through the
  command registry, the chat activation router, the runtime skill catalog, and the managed
  skill assets so the route reaches a real installed body rather than an orphaned document.
- Add a repo-local `AGENTS.md` describing this package's entry points, `.ts` import convention,
  planning-only agent boundary, and verification commands. Tracked in git and excluded from the
  published package by `.npmignore`.

## 0.1.58 Release Scope

- Keep `lit`, `litwork`, `start-work`, and `review-work` status reads usable when the durable
  ledger contains legacy or malformed events: status paths skip invalid lines through the lenient
  reader and surface a bounded skipped-count diagnostic, while append, recovery, and
  bounded-authority lifecycle paths keep failing closed on malformed records.
- Keep the CI dry-pack report outside the package root and reject non-finite evaluator deadline
  seconds as typed CLI input errors.

- Promote the UI/UX Design Contract to evidence-eligible `v1beta2` and keep valid `v1beta1` contracts compatible. Keep the material Visual QA Evidence Manifest at `v1beta1`. Keep alpha input parseable for diagnostic compatibility but ineligible for PASS evidence.
- Bind immutable manifest and source evidence to exact caller-authorized regular-file descriptors, reject lexical-root-only and incomplete descriptor sets, and close every transferred descriptor exactly once on success or any blocked return.
- Require material `pass` evidence for every contract-required channel. Let smoke follow its declared review inventory, while full and reference-fidelity tiers require host-proven reviewer provenance rather than self-attested receipt JSON.
- Ship the two-lane repository rules engine with bounded discovery, static and glob-scoped delivery, deduplication, compaction-aware reinjection, and untrusted-data fencing.
- Ship the evidence-ledger loop CLI verbs and their `brief.md`, `goals.json`, and append-only `ledger.jsonl` state contract without weakening completion or review-blocker gates.
- Ship LitResearch's append-only `claim-graph.jsonl` protocol and verification gate together with the required package-root attribution notice; unverified claims remain outside synthesis.
- Ship Lit Plan's plan scaffolder, machine-checkable checklist row grammar, and sticky high-accuracy review gate without granting the planning agent execution authority.
- Enroll the LSP capability/setup and structural-search guidance plus the added `lit-burnoff-file`, `comment-checker`, `debugging`, `deep-interview`, `lsp`, `lsp-setup`, `rules`, and `structural-search` skill and route surfaces that exist in the prepared tree.
- Keep the rules glob differential reproducible from this repository alone: `picomatch` is a dev dependency, the runtime matcher remains dependency-free, and no sibling checkout or environment fallback may satisfy the gate.
- Ship `frontend-ui-ux` and `visual-qa` as recursively managed native skills with bounded lazy activations, preserved detailed contracts, deterministic offline runtime helpers, strict schema/runtime parity, licensed provenance, and hash-checked install/doctor enrollment.
- Keep each managed skill tree self-contained: every helper import must resolve inside that skill's own `scripts/` directory, so the manifest's exact-tree check and the runtime import graph cover the same files. A cross-tree import is a release blocker because integrity can pass while imports are broken.
- Keep both model-facing UI/UX activations at or below 4096 UTF-8 bytes. Each concise `SKILL.md` must route `references/complete-contract.md`; that detailed frontend contract must keep one question-bearing table row for each of the fifteen focused topic documents. An unrouted detail document is a release blocker.
- Keep the `visual-qa` verdict families disjoint: `BLOCKED_*` names an absent capability, `FAIL_*` names a completed check that rejected the work, and blocked outranks fail. A review failure routed to a blocked code is a release blocker.
- Regenerate `skills/managed-skill-manifest.json` with `npm run gen:managed-skill-manifest` whenever a managed skill asset is added, removed, or edited. Never hand-edit it.
- Exercise the exact eight-scenario benchmark only through installed public validators, pair every seeded defect with a no-finding control, and fail closed if the installed capability tree mutates.
- Keep reference dimensions/hashes, Design Contract date-time/source/count boundaries, evidence/review contracts, PNG/TUI resource bounds, and importer realpath containment covered by focused and packed-consumer probes.
- Keep the `docs/reference.md` Runtime Skills catalog in exact membership with the actual top-level `skills/*/SKILL.md` directories. A new, omitted, duplicated, or stale catalog id must fail the docs guard; release prose must not hard-code a count that can drift.
- Ship the exact verified 167-file canonical frontend reference library as a separately managed, byte-preserved corpus with its legal files and path/size/SHA-256 manifest, without changing the normalized retrieval dataset or granting execution or fetch authority.
- Ship Autoresearch as one recursively managed ten-mode family, Autoconference as one recursively managed seven-mode family with an explicit Autoresearch dependency and fail-closed OpenCode task-capability gate, and Wikify as one recursively managed five-mode local-wiki family.
- Enroll the family trees, nested contracts, templates, provenance, licenses, command aliases, bounded leading chat activation, package payload, installer, and doctor checks without adding tools, agents, MCP servers, daemons, publication actions, or implicit write authority.
- Keep Autoresearch and Autoconference plan routes read-only until an approved `lit-plan` packet enters explicit `/start-work`; keep Autoconference children depth-one and packet-only, and keep Wikify sources inert and local with LitResearch evidence receipts and review-work continuity.

## Preflight

- Confirm `package.json` name is `@litfamily/litopencode`, its executable alias is `litopencode`, and native IDs remain `litopencode`.
- Confirm `package.json` and `package-lock.json` versions are in lockstep.
- Confirm both README entry paths, `docs/reference.md`, `docs/reference-Ko-KR.md`, `docs/migration.md`, and `docs/release-checklist.md` describe the current implementation state. Use the authoritative family handoff from the umbrella root for family-level state.
- Confirm installer, doctor, and README describe `~/.config/opencode/litopencode.json` and per-agent model routing.
- Capture the installer in a real pseudo-terminal and verify numbered stages, active spinner motion, retained completion lines, aligned borders at 80 columns, the stage-three write boundary, the final restart/Tab receipt, and a readable `NO_COLOR` fallback. Confirm CI/non-TTY/dry-run output remains stable.
- Confirm a fresh config hook routes lead, planning, and review roles to `openai/gpt-6-astra`/`xhigh`, while execution/research helpers and ordinary workers use `openai/gpt-6-luna`/`max`; `gpt-6-sol`/`xhigh` remains the coding-lead alternative. Ordinary install/update preserves existing model routes, and explicit global/project category and per-agent routes preserve unrelated OpenCode settings.
- Confirm existing `momus` and `litwork-reviewer` host entries preserve any explicit route and host fields, while route-less entries receive Astra/xhigh without losing prompts, tools, or permissions. Confirm packed install accepts GPT-6 Luna/xhigh, rejects GPT-6 Luna/ultra and GPT-5.6 Luna/xhigh before success output, preserves custom model IDs, and doctor lists every authored effective route with unsafe diagnostics without rewriting user config. Keep concurrency 20 `advisory` without inventing a numeric worker-limit key.
- Confirm balanced/YOLO permission modes remain explicit opt-in only, default installs do not relax permissions, `lit-plan` edit/bash deny guards remain enforced, and docs tell users to restart OpenCode after config changes.
- Confirm README, runtime skills, and feature catalog state the verified native goal verdict and keep durable goal state under `.litopencode/litgoal`.
- Confirm the Runtime Skills section in `docs/reference.md` exactly matches the actual top-level skill directories and the forced listener-denial regression runs all no-network security cases with zero skips.
- Confirm the packed `vendor/` corpora for `lit-handoff` and `lit-scientific-visualization` preserve their managed inventories and hashes, while installed native skills remain flat wrappers that preserve user-owned collisions; exclude `.pyc` and report scientific Python dependency readiness without installing dependencies.
- Confirm `.litopencode/`, `.litcodex/`, generated evidence, reference archives, fixture-only paths, and package archives are excluded from the packed payload.
- Verify the README motion cover at `docs/assets/cover-motion.webp` and its reduced-motion still
  `docs/assets/cover-motion-still.webp`: confirm the Markdown rendering and alt text in both READMEs,
  and retain the independent canonical ASCII hero. Verify the Ignition vector cover at
  `docs/assets/cover.svg` against the current Ignition vector product exports. The SVG must use explicit geometric
  paths and outlined glyphs without embedded raster, scripts, external resources, or font dependencies.
  Keep obsolete root covers and generators archived outside this product, preserving their bytes.
  Pack JSON must exclude `cover.png`, `docs/assets/cover.*`, `generate_cover.py`, and
  `docs/release-checklist.md`, while keeping operational docs, compiled CLI/plugin/types,
  skills and vendor closures. Small native icons are not covered by the cover exclusion.

## Required Gates

Run these commands from the repository root:

```sh
npm run build
npm test
npm test
npm run typecheck
npm run check:managed-skill-manifest
npm run scan:legacy-tokens
npm run check:version
npm run check:pack-payload
npm run qa:negative-gate-matrix
npm run qa:installed-resource-tamper
npm run qa:behavior-replacement
npm run qa:rules-glob-differential
npm pack --dry-run --json
```

`npm run qa:real-surface` builds once and then runs the four probes in this order: `qa:negative-gate-matrix`, `qa:installed-resource-tamper`, `qa:behavior-replacement`, and `node tools/run-wikify-surface-probe.mjs`.

Expected results:

- tests pass twice to reduce stale or misleading success output risk
- build emits `dist/*.js` and `dist/*.d.ts`
- typecheck exits cleanly
- managed-skill manifest reports zero drift; unpinned, changed, or missing managed assets fail the gate
- scanner exits cleanly with zero guarded-token matches and no allowlist exemptions
- version lockstep exits cleanly
- payload guard exits cleanly
- the negative gate matrix reports every standing row, prints its negative control as `mismatch-detected=YES`, and exits non-zero on any row whose observed outcome differs from its expectation
- the tamper probe reports clean, corrupted, and restored integrity for one pinned managed asset and a cleanup receipt with `remaining_paths=0`
- the behavior probes report `REPLACED` for update-notifier concurrency, the schema-3 bounded-authority lifecycle, and subagent depth-one containment
- the rules glob differential resolves repo-local `picomatch`, reports only the documented pinned dialect classes, and reports zero unpinned divergences
- dry pack emits a manifest and leaves no root package archive behind

## Replacement Real-Surface QA

The `qa:*` scripts are the replacement layer for behaviour that the unit tests
prove indirectly. They are additive: they run alongside `npm test`, never instead
of it, and no test or fixture may be removed until this layer proves equal or
better coverage of the behaviour being retired.

| Script | Surface it drives | What it proves |
| --- | --- | --- |
| `qa:negative-gate-matrix` | installed `skills/frontend-ui-ux/scripts/uiux.mjs`, installed `skills/visual-qa/scripts/visual-qa.mjs`, `litopencode doctor`, `tools/check-pack-payload.mjs` | seventeen negative-gate rows, each with its expected and observed outcome, plus a negative control that proves the comparator can fail |
| `qa:installed-resource-tamper` | `litopencode install` and `litopencode doctor` against an isolated temporary root | a corrupted pinned managed asset fails integrity by name and passes again once restored |
| `qa:behavior-replacement` | shipped `dist/cli/update-check.js`, shipped `dist/index.js` plugin exports and `config` hook | update-notifier concurrency including future-dated cache and lock timestamps, schema-3 bounded-authority CAS fail-closed idempotency, and subagent depth-one containment |
| `node tools/run-wikify-surface-probe.mjs` | Wikify tool, `tool.execute.after`, chat, and command hooks against isolated temporary state | Wikify capture/save flow, review-needed automatic receipts, route reachability, and no live-profile mutation |

Rules the layer keeps:

- Every probe runs against an isolated `mkdtemp` root. No probe reads or writes a
  live profile, and each driver ends with a cleanup receipt naming every
  temporary path it removed.
- A row that cannot be exercised is reported as `BLOCKED` with its exact reason.
  It is never dropped and never reported as passing.
- Two rows diverge from the shorthand in the standing matrix. `capture bytes
  changed after manifest` and `same-context self-review` are written as FAIL
  there, while this runtime answers `BLOCKED_IMMUTABLE_INPUT_MISMATCH` and
  `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE` because a blocked capability outranks
  a failed check. Both rows print `standing-matrix=` next to the shipped
  contract outcome and a `MATRIX-DIVERGENCE` line, so the difference is visible
  rather than reconciled away.

## Packed Artifact Probe

After the source gates pass, verify the packed artifact in a temporary directory:

```sh
tmp="$(mktemp -d)"
version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
npm pack --pack-destination "$tmp"
tar -xzf "$tmp"/litfamily-litopencode-"$version".tgz -C "$tmp"
node --input-type=module -e "import('$tmp/package/dist/index.js').then((m) => { const id = m.default?.id ?? m.pluginId; if (id !== 'litopencode') throw new Error('unexpected plugin id'); console.log(id) })"
(
  cd "$tmp/package"
  npm run scan:legacy-tokens
  npm run check:version
  npm run check:pack-payload
  npm run typecheck
)
rm -rf "$tmp"
```

Expected results:

- plugin import prints `litopencode`
- package payload includes compiled `dist/*.js` and `dist/*.d.ts` files, not `src/*.ts`
- package payload includes the package-level `vendor/handoff/` and `vendor/scientific-visualization/` trees plus their approved legal/provenance files, without `.pyc`
- `scan:legacy-tokens` reports zero guarded-token matches; non-empty allowlist entries are not release exemptions
- `check:version` skips lockstep when the source-only lockfile is absent from the packed artifact
- `typecheck` skips when TypeScript dev dependencies are not installed in the packed artifact
- `check:pack-payload` still validates the packed manifest

## Installed Package Probe

After the packed artifact probe, verify the public install surface in a clean temporary npm project:

```sh
tmp="$(mktemp -d)"
version="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
npm pack --pack-destination "$tmp"
mkdir "$tmp/consumer"
(
  cd "$tmp/consumer"
  npm init -y
  npm install "$tmp"/litfamily-litopencode-"$version".tgz
  npm ls @litfamily/litopencode --all
  node --input-type=module -e "import('@litfamily/litopencode').then((m) => { if (typeof m.default !== 'function' || m.pluginId !== 'litopencode') throw new Error('unexpected package exports'); console.log(m.pluginId) })"
  node_modules/.bin/litopencode --help
  node_modules/.bin/litopencode doctor --root .
  node_modules/.bin/litopencode install --dry-run --root .
  node_modules/.bin/litopencode install --dry-run --root . --yolo
  node_modules/.bin/litopencode install --dry-run --root . --permission-mode balanced
  node_modules/.bin/litopencode install --root .
  test -f litopencode.json
)
rm -rf "$tmp"
```

Expected results:

- `@opencode-ai/plugin` is declared consistently with `package.json` dependencies so TypeScript host typings and runtime imports resolve in packed and installed probes
- package import prints `litopencode`
- CLI help, doctor, install dry-run, and write-enabled install exit 0
- `install --dry-run --yolo` exits 0, reports `permissionMode: yolo`, and writes no files
- `install --dry-run --permission-mode balanced` exits 0, reports `permissionMode: balanced`, and writes no files
- write-enabled custom-root install creates or updates `opencode.json`, creates `litopencode.json` when missing, and preserves existing `litopencode.json` agent routes without echoing unrelated config secrets
- write-enabled custom-root install exposes both flat managed native skill wrappers to OpenCode discovery; doctor hash-checks the package-vendored source and reports scientific Python readiness separately
- temporary project cleanup removes the probe directory

## OpenCode Host Probe

Use the installed temp-project package, not the source tree, to import `@litfamily/litopencode`, import `@litfamily/litopencode/server`, call the plugin function, invoke the config hook, chat-message hook, command hook, `lit`, `litwork`, `start-work`, and `review-work` tools, and before/after tool guard hooks. Expected results:

- `server()` exposes config, tool, chat-message activation, command activation, text-completion, dispose, and non-enumerable tool guard hooks
- config registers the LitOpenCode agent roster
- config applies the shipped role split to every registered agent and proves a project-local per-agent route can replace an exception default
- config applies `litopencode.json` provider/model/reasoning overrides to `lit-loop`, `lit-plan`, `lit-implement`, and configured specialist agents
- config exposes exact LUNA model plus selected variant routes, keeps `lit-plan` deny guards, and treats at most 20 concurrent subagents as advisory because OpenCode has no verified numeric hard-limit setting
- an explicit LUNA installer selection writes the host-native LUNA `limit.context`/`limit.input` ceiling of `372000`, `limit.output` of `128000`, and `compaction.reserved` of `37200`, which OpenCode 1.17.18 evaluates as the 334800-token auto-compaction threshold; all non-selection installs preserve existing host values
- config applies `permissionMode: "balanced"` or `permissionMode: "yolo"` as explicit OpenCode top-level permission policies, including YOLO `external_directory`, while `lit-plan` remains agent-level edit/bash `deny`
- native goal verdict remains explicit: host-native goal support is not claimed when the current CLI/plugin surface does not expose it
- `/litwork`, `/start-work`, `/review-work`, `/lit-korean`, and `/text-neutralization` command activation records durable redacted ledger events
- standalone prompt `lit` and explicit route phrases (`lit plan`, `lit review`, `lit research`, `lit goal`) inject the matching host-adapted directive without storing raw prompt text or firing on slash-command mentions; start-work chat activation requires leading `start-work` or `lit start work`, while diagnostic, copied, quoted, and blockquote mentions never select start-work or append a false start-work event; an independent final `lit` in such diagnostic prose still activates only `lit-loop`, and ordinary prose such as `research ... lit` remains on the default lit-loop directive
- schema-3 `/start-work` lifecycle probes cover init/pause/trusted resume/cancel/complete, monotonic CAS, session/work fail-closed behavior, bounded compaction and reconciliation, consumed-grant retention, exact fenced progress, one-continuation delivery receipts, and inert copied/quoted/slash/stale text
- exact bare `handoff` and `lit-scientific-visualization` messages select their native routes; slash and bare routes select the discipline for a session-local standard/micro completion mark, while generic, quoted, fenced, multipart mixed, and near-miss text cannot activate a discipline. The model emits its own first-line probe; the hook never fabricates it.
- `lit`, `litwork`, `start-work`, and `review-work` tools record durable ledger events
- malformed LitOpenCode tool args are denied fail-closed

## Benchmark-Backed Superiority Guard

Any benchmark-backed superiority statement against the REFERENCE must be checked through the exported claim policy before release notes, README copy, or package docs use it.

- Run or inspect `classifyReferenceSuperiorityClaim` for the exact wording.
- Run or inspect `benchmarkGateAllowsStrongClaim` for the measured suite result.
- Universal or unconditional claims are blocked, including wording that says LitOpenCode is always better, better on every possible real task, or “무조건” better.
- Strong wording is allowed only when scoped to the measured OpenCode-native benchmark suite and every threshold passes.
- For a declared benchmark universe, run `certifyDeclaredBenchmarkUniverse` and `renderDeclaredBenchmarkUniverseClaim`; this may say all tasks in that declared universe passed, but it must not imply all possible real development tasks.
- If the claim guard returns `blocked`, replace the wording with the safe benchmark-scoped alternative returned by the API.

## GitHub and npm README Pages

The repository's `README.md` and `README-Ko-KR.md` are the GitHub pages: the full guide, skills gallery and A/B results, with assets loaded by relative `./docs/...` paths. The npm package page is a shorter card kept in `README-npm.md` and `README-npm-Ko-KR.md`, with every asset and link pinned to `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@<version>/`. Those pinned URLs return 404 until the version is published. The npm sources use a hyphen, not `README.npm.md`, because npm always packs root files named `README.*`.

`tools/readme-for-npm.mjs` swaps the pages:

- `node tools/readme-for-npm.mjs check` validates the npm pages: every jsDelivr pin matches `package.json`, no relative or non-HTTPS target remains, the GitHub full-guide link is present, the repository-only checklist is not linked, and each page stays under 32 KiB and under half of its GitHub page.
- `apply` runs `check`, saves the GitHub pages with their SHA-256 in the ignored `.readme-npm-backup/` directory, and copies the npm pages over `README.md` and `README-Ko-KR.md`. A second `apply` is a no-op.
- `restore` puts the GitHub pages back byte-identical after checking the recorded hashes, then removes the backup.

`prepack` runs `npm run build && node tools/readme-for-npm.mjs apply` and `postpack` runs `restore`, so a plain `npm pack` or `npm publish` packs the npm pages and leaves the working tree unchanged. `prepublishOnly` runs before `prepack`, so the test gate still reads the GitHub pages. `.npmignore` and `check:pack-payload` keep `README-npm*.md`, `.readme-npm-backup/` and the swap script out of the tarball.

A publish that passes `--ignore-scripts` skips `prepack` and `postpack`. For that flow, run the tests first, then:

```sh
node tools/readme-for-npm.mjs apply
npm publish --access public --ignore-scripts
node tools/readme-for-npm.mjs restore
```

Do not run `npm test` or `prepublishOnly` while the npm pages are applied; the README tests read the GitHub pages and fail. If a pack fails before `postpack`, run `restore` by hand. `npm pack --dry-run --json --ignore-scripts` lists the same files with or without the swap; only the contents of the two README files differ.

## HUMAN-ONLY Registry Publication

The automated readiness workflow stops before registry mutation. After every
required gate passes from a clean checkout, the exact target version returns
`E404`, `npm whoami` confirms the intended account, and the user gives final
explicit publication approval, run this command from the repository root:

```sh
npm publish --access public
```

This command publishes only the scoped `@litfamily/litopencode` package described by the
root `package.json`. It does not authorize or create a Git tag, GitHub Release,
or live OpenCode installation; each remains a separate human-approved action.

## No-Publication Guardrails

- Do not run the npm registry publication command in this workflow.
- Do not push repository refs from this workflow.
- Do not create or move repository tags from this workflow.
- Do not add npm or node auth token values, token variables, or registry credentials to local files, CI, evidence, or docs.
- Do not add a release job, deploy job, publication secret, write permission, or history rewrite step without explicit user authorization.
- CI must keep `permissions: contents: read` and must continue to run tests, typecheck, scanner, version lockstep, dry pack, and payload guard.

## Payload Review

Use `npm pack --dry-run --json --ignore-scripts` after `npm run build` as the observable package surface for payload checking. The manifest must include only public package files required for the compiled JavaScript plugin, type declarations, CLI, docs, and guard scripts. It must not include local state, implementation evidence, reference archives, temporary fixtures, dependency folders, source TypeScript, or generated package archives. Source-only guard inputs such as `package-lock.json` and `tools/legacy-token-allowlist.json` stay out of the public payload; their scripts must degrade explicitly and safely when those inputs are absent in the packed artifact.

## Final Verification Reminder

FV-ALL-style verification is reproducible from the commands below. Do not cite a
local maintainer evidence path as public release proof; local evidence
directories stay untracked and out of the package.

Final verification must run `npm test` twice, then `npm run typecheck`, `npm run scan:legacy-tokens`, `npm run check:version`, `npm run check:pack-payload`, and `npm pack --dry-run --json`. It must also replay the isolated CLI dry-run, durable-ledger, documentation, runtime-skill, and OpenCode host probes described above against the current candidate bytes.
