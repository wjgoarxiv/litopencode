# LitOpenCode Migration Guide

This guide describes the supported migration shape for moving an OpenCode workflow adapter to LitOpenCode. Keep this document brand-clean for public package payloads.

## Package

- Use `@litfamily/litopencode` as the npm package name and OpenCode package-loading reference. Keep `litopencode` as the CLI binary and native namespace.
- Configure OpenCode plugin loading with the exact `@litfamily/litopencode@<version>` package entry; preserve native IDs and migrate legacy package entries as described below.
- Treat upstream or sibling repositories as behavior references only. Product code in this package is OpenCode-native TypeScript authored for this repo.

## Environment And Config

- Use the `LITOPENCODE_` prefix for LitOpenCode-owned environment variables.
- Keep default OpenCode plugin configuration in OpenCode's managed `opencode.jsonc`; custom-root LitOpenCode previews use `opencode.json`.
- Keep global LitOpenCode agent route configuration in `~/.config/opencode/litopencode.json`, or `$XDG_CONFIG_HOME/opencode/litopencode.json` when `XDG_CONFIG_HOME` is set.
- Keep LitOpenCode runtime config in `.litopencode/config.json` when project-local config is needed.
- Use `npm exec --package @litfamily/litopencode -- litopencode install` to delegate default setup to `opencode plugin <target> --global --force`; packaged installs use the current `@litfamily/litopencode` version, while local checkout installs use the package path.
- The installer creates `litopencode.json` only when it is missing. The config hook routes the lead categories and `lit-loop` to `openai/gpt-6-astra`/`xhigh`; execution/research helpers use the fresh default `openai/gpt-6-luna`/`max`. Ordinary install/update preserves an already configured model; only an explicit model prompt changes managed routes.
- Interactive installs render a persistent five-stage TTY timeline with active spinner motion, stage-purpose text, an explicit stage-three write boundary, retained completion lines, and one restart/Tab receipt. CI, non-TTY, `NO_COLOR`, and `--dry-run` paths retain plain or machine-readable output.
- Use `litopencode doctor --root <workspace>` to inspect package metadata, config source, runtime paths, and ledger location without writing files.
- Packaged plugin startup and successful interactive `install`/`doctor` management commands run a bounded foreground automatic-update barrier by default. It installs only an exact newer stable `@litfamily/litopencode@<version>` into a private staging prefix, invokes the staged installer with `--no-auto-update`, and requires a matching post-install `doctor --json` result before the transaction succeeds. The separate `~/.litopencode/auto-update-install.lock`, journal, receipt, and private backup keep rollback evidence outside project/config roots; rollback is fingerprint-verified, and an unknown staged state or impossible rollback stops the host without a success claim while retaining the backup path. Use `--no-auto-update` or `LITOPENCODE_NO_AUTO_UPDATE=1` to disable it; `NO_UPDATE_NOTIFIER` and `LITOPENCODE_NO_UPDATE_CHECK` remain higher-precedence opt-outs.
- The detached update notifier is still cache-refresh-only. It may print a prior validated version on eligible interactive commands, but it never installs; its state remains `~/.litopencode/update-check.json`.
- Use `litopencode doctor --root <workspace>` to inspect `litopencode.json` route validity and effective `lit-plan` / `lit-loop` settings without writing files.
- Use `litopencode install --dry-run --root <workspace>` to preview the `opencode.json` plugin mutation without writing files.
- Route fields include top-level `permissionMode` (`safe`, `balanced`, or `yolo`) plus per-agent/per-category `provider`, `model`, `variant`, `category`, `reasoningEffort`, `textVerbosity`, `thinking`, `temperature`, `topP`, `maxTokens`, `promptAppend`, `tools`, `permission`, and `providerOptions`; generated route files use `variant` as the primary effort knob while `reasoningEffort` stays available for explicit provider-level overrides. LitOpenCode keeps `topP` as its config spelling and projects it to OpenCode's native `top_p` field; this preserves nonreasoning model sampling while Astra's native Responses capability omits unsupported sampling fields.
- Global route config loads first, project-local route config merges afterward, and effective per-agent fields override category fields. Fresh/reset lead routes use Astra with native `reasoningEffort`. GPT-6 Astra and Sol accept `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. GPT-6 Luna accepts `low`, `medium`, `high`, `xhigh`, and `max`, but not `ultra`. Previous-generation GPT-5.6 Luna accepts only `high` and `max`; `xhigh` remains unsupported for that model. Astra has no invented `-fast` alias. No-selection installs preserve user route bytes but fail before success output when a managed route is unsafe. Other model IDs remain user-owned custom routes. Existing host entries named `momus` or `litwork-reviewer` preserve explicit routes and receive Astra/xhigh only when route fields are absent. LitOpenCode does not expose Hermes-specific per-subagent overrides.
- Use `litopencode install --permission-prompt`, `--permission-mode balanced`, or `--yolo` only when you explicitly want LitOpenCode to reduce OpenCode approval prompts. Default installs do not relax permissions. Balanced mode allows routine automation while keeping dangerous bash patterns on ask; YOLO mode writes `permissionMode: "yolo"` and the plugin config hook allows OpenCode `bash`, `edit`, `webfetch`, and `external_directory` globally. In both balanced and YOLO modes, `task` delegation is granted only to execution-capable primary agents; subagents and `lit-plan` stay task-denied so delegation never recurses and the planner cannot select an implementation child. Existing global string/object and per-primary task policies are preserved unless they would weaken those hard deny guards; absent global task policy is not invented, and the runtime lineage guard blocks child task calls even under an explicit global allow. `lit-plan` remains agent-level edit/bash/task `deny`.
- Restart OpenCode after changing `permissionMode`; OpenCode loads config at startup and running sessions keep the already-loaded permission policy.
- Planning routes now produce proportionate objective-achievable checklists rather than relying on a later review pass to discover missing execution detail. Each retained item carries action/output/verification, while risky or multi-stage work receives SDD-like gates only when justified. `/review-work` accepts both draft plans (read-only `PASS`/`ITERATE`/`NEEDS-CONTEXT`) and completed work (the existing five-lane review); it never implements a draft plan.
- Keep `/start-work` as the native executable handoff to `lit-implement`. Chat-only start-work activation must begin with `start-work` or `lit start work`; diagnostic, copied, quoted, and blockquote mentions must not select start-work or append a false start-work event. An independent final `lit` remains an ordinary `lit-loop` activation.
- Schema-3 bounded-authority state is package-owned under `.litopencode/litgoal/lit-loop`. Existing activity ledgers remain readable; strict `/start-work init|resume|cancel|complete|status` directives create and advance the separate work snapshot and bounded journal. Resume is trusted-user-only and the generic `start-work` tool does not gain a resume action.
- Do not claim native goal binding unless the current OpenCode CLI or plugin API exposes a goal primitive; use LitOpenCode-owned `.litopencode/litgoal` state for durable goal behavior.

## Durable State

LitOpenCode runtime state is intentionally separated from planning and agent evidence:

- project runtime root: `.litopencode/`
- durable goal root: `.litopencode/litgoal/`
- durable ledger: `.litopencode/litgoal/lit-loop/ledger.jsonl`
- user/global root: `~/.litopencode`
- OpenCode route config: `~/.config/opencode/litopencode.json`
- implementation evidence root: `.litopencode/litgoal/lit-loop/evidence/`

The durable ledger uses atomic write behavior and recovery for partial temporary files. Existing state from a previous adapter should be copied only after a deliberate review, then represented as LitOpenCode ledger events rather than mixed directly into the new ledger file.

## Vocabulary

Use LitOpenCode vocabulary in docs, config, runtime output, and issue reports:

- product: `LitOpenCode`
- npm package and OpenCode package-loading entry: `@litfamily/litopencode`; native namespace and binary: `litopencode`
- activation commands/tools: `lit`, `litwork`, `start-work`, `review-work`, `lit-recap`, `lit-korean`, `text-neutralization`
- durable loop: `lit-loop`
- durable goal manager: `litgoal`
- current planning/research workflow names: `lit-plan`, `lit-crucible`, `litresearch`, `start-work`, `review-work`
  - `lit-plan` creates a planning-only objective-achievable checklist; `lit-crucible` adversarially tests assumptions before handing surviving insights to `lit-plan`.
  - `litresearch` runs the root-owned evidence workflow; `start-work` executes an approved plan through `lit-implement`; `review-work` reviews either a draft plan or completed work without inventing another workflow surface.

Legacy vocabulary must not appear in tracked files or release payloads. Do not introduce old package names, host claims, or environment prefixes into new product docs, tests, source, fixtures, or release artifacts.

## Migration Checklist

- Migrate npm/package-loading references to `@litfamily/litopencode`; preserve `litopencode.json`, native IDs, and the `litopencode` binary.
- Move LitOpenCode-owned environment settings to `LITOPENCODE_` names.
- Keep runtime state and implementation evidence under `.litopencode/litgoal`.
- Keep user-specific agent model/provider/reasoning overrides in `litopencode.json` or project-local `.litopencode/config.json`; those overrides remain authoritative over shipped role defaults.
- Keep visible static skills under `skills/*/SKILL.md`; they document workflow loop, durable litgoal, agent roster, lit-plan, start-work, review-work, reference benchmark claims, native goal verdict, doctor installer, search workflow ideas, public-source fetch, release guardrails, lit-init, lit-crucible, refactor, lit-burnoff, lit-code, lit-commit, text naturalization, lit recap, litwork activation, and tool guards without dynamic execution.
- Run `npm run scan:legacy-tokens` after any migration wording change.
- Run `npm run check:pack-payload` and `npm pack --dry-run --json` before sharing a package artifact.

## Skill ID renames

Use `lit-crucible`, `lit-init`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`,
`lit-korean`, `lit-fetch`, and `lit-code`. The Unreleased changelog records the old-to-new
mapping. Old bare-word invocations select the new skill and inject exactly one line:
``Note: `<old>` was renamed to `<new>`; the old name is removed in the next minor.``
Quoted text, code fences, and compound-word
near-matches remain inert. Slash commands resolve through one-release redirects.

Canonical command, skill, feature, help, and doctor catalogs contain the new IDs.
The installer writes short old-command redirect files separately from these catalogs,
preserves user-owned command files, and routes the planning redirect through `lit-plan`.
`lit-plan` retains its denied edit, bash, and task permissions.

The generated managed-skill manifest records the migration map under the new IDs.
After staging, verifying, and swapping each new skill, install/update removes its previous
directory only when the existing LitOpenCode ownership marker identifies a managed tree.
Unmarked files and directories are preserved; symlinked or special-file managed trees are
refused. A collision at the new name preserves both trees so an unavailable replacement
cannot destroy the old installation. Dry-run remains read-only. The existing
`text-neutralization` route continues to select the Korean contract.

This port also exposes explicit commands for the single-file cleanup and public-fetch
skills so all eight old names have a real redirect target. The single-file route still
requires exactly one named file. Verification filenames now use the canonical skill IDs,
and shipped contracts reference the renamed tests. The debugging reference corpus uses
local runtime guides and has no `references/methodology/02-investigate.md` or ancestor
`subagent_type` example to replace.

The rename also joins previously separate parity groups. The recorded Korean-prose
closures remain 4/3/4/1/1 files across the five ports; public fetch is a twelve-file
standalone reader in one port and one skill contract backed by compiled runtime in
OpenCode. Dated parity divergences preserve those existing native designs. No corpus
files were added merely to match another host's file count. Other products' recorded
closure counts remain historical until the root verification refreshes them.

## Scoped npm package migration

`@litfamily/litopencode` is the npm identity and the package-loading target.
The commands below install that exact scoped identity; the old package does not
automatically redirect or update itself to the new identity.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run --no-auto-update
npm exec --package @litfamily/litopencode@latest -- litopencode install --yes --no-auto-update
npm exec --package @litfamily/litopencode@latest -- litopencode doctor --json --no-auto-update
```

Use the same config root as the previous installation (`--root <directory>` for a
custom root). Install replaces old `litopencode` and `litopencode@<version>` package
registrations with the new exact scoped version, coalesces duplicate old/new entries,
and preserves the first registration's tuple options. Foreign plugins and authored
`litopencode.json` model/permission routes remain in place. Existing local checkout
registrations are recognized on the native default-root install path. An ambiguous
foreign skill directory is a collision, not permission to overwrite it. Installer-owned
files follow the existing ownership checks; keep backups of custom command/skill edits
and review any reported preserved or invalid files before proceeding.

The executable remains `litopencode`. Native registration/metadata markers,
`LITOPENCODE_*` environment options, `~/.litopencode` update state, and project
`.litopencode/` ledgers keep their names. An old-name registry cache is discarded as
update authority; only exact scoped response/cache identities can suggest or install
a scoped version. That does not trigger a version change by itself.

For a previous global npm install, record the old package/version first. Remove the old
global npm package **before** installing the new global one because both own the same
binary alias. Removing it after the new package may remove the shared binary link.

```sh
npm uninstall -g litopencode
npm install -g @litfamily/litopencode
litopencode install --yes --no-auto-update
```

There is no CLI uninstall subcommand. Disable the package by removing its exact scoped
entry (or legacy entry on an old installation) from the OpenCode `plugin` array; tuple
entries use the first element as the package ID. Remove the installed npm package with
`npm uninstall -g @litfamily/litopencode` only if it was installed globally. Review command
and skill copies individually: delete only confirmed unmodified installer-owned files,
preserve foreign/edited files, routes, and ledgers, then restart OpenCode. Do not erase
all of `skills/`, `command/`, or `.litopencode/` as a migration shortcut.

Offline package verification uses the actual old and scoped tarballs in isolated
npm prefixes, HOME, XDG config, TMPDIR, and npm cache directories. It exercises fresh,
old-to-new, repeat, doctor, compiled plugin hooks, and manual removal separately.
Local package/host-shaped proof does not establish registry availability or an
authenticated OpenCode session. [Privacy](privacy.md) describes network and local state.

The intermediate `@litfamily/opencode` config entry is also replaced conservatively
by the installer, including tuple entries with options. It is a configuration
compatibility entry, not a published legacy package or a separate public migration target.
