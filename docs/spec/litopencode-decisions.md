# LitOpenCode Decisions

This document is normative for the LitOpenCode port. If it conflicts with a later implementation note, this file wins unless explicitly amended.

## D1 - Host Boundary

LitOpenCode targets OpenCode's TypeScript plugin system. Host integration must use OpenCode plugin modules, hooks, config mutation, tools, local `.opencode` assets, and npm plugin loading. Codex-, Claude-, or Hermes-specific implementation files are not portable product code.

## D2 - Adapt-Not-Copy

Upstream and sibling repos are references for behavior, hardening, and architecture. LitOpenCode product code must be re-authored for OpenCode. Literal imports from upstream are allowed only for stable public dependency APIs; copied product files are not acceptable.

## D3 - Package Name (Confirmed)

The npm package is `@litfamily/litopencode`; the primary binary and native plugin ID remain `litopencode`.

Status: native identity confirmed by user on 2026-06-14; scoped npm migration approved for local preparation on 2026-09-06.

## D4 - Distribution Shape (Confirmed)

First wave distribution is a TypeScript npm plugin plus installer/doctor CLI. Do not ship compiled platform binaries in the initial implementation.

Rationale: OpenCode natively loads local TypeScript/JavaScript plugins and npm packages. Upstream has platform package directories, but the public-ready minimum can be simpler and safer.

Status: confirmed by user on 2026-06-14.

## D5 - Runtime State

Project runtime state lives under `.litopencode/`. User/global runtime state lives under `~/.litopencode`. State writes must be durable and atomic for ledgers and goal/loop files.

## D6 - Environment Prefix

All LitOpenCode-owned environment variables use `LITOPENCODE_`. Legacy prefixes are denied in product code and published artifacts.

## D7 - Workflow Vocabulary

Current workflow names: `lit`, `litwork`, `lit-loop`, `litgoal`, `lit-plan`, `lit-crucible`, `litresearch`, `start-work`, `review-work`, `lit-init`, `lit-recap`, `lit-handoff`, `lit-scientific-visualization`, and `lit-humanizer`.

`lit` and `litwork` activate the durable `lit-loop`; `litgoal` owns package-managed goal state. `lit-plan` is planning-only, while `lit-crucible` adversarially tests assumptions before handing surviving insights to `lit-plan`. `litresearch` owns evidence-backed research, `start-work` routes approved execution to `lit-implement`, and `review-work` reviews either draft plans or completed work. The remaining names expose the installed repository-discovery, recap, handoff, scientific-visualization, and prose-review workflows; D7 does not reserve names for absent surfaces.

## D8 - Goal/Loop Surface (Confirmed)

OpenCode has verified plugin hooks, custom tools, commands, and agents. Local verification with `opencode --help` and the installed `@opencode-ai/plugin` Hooks type surface did not expose a native OpenCode goal primitive.

Implement a LitOpenCode-owned durable goal manager under `.litopencode/litgoal`, exposed through OpenCode custom tools and/or commands, with hook support for reminders/continuation where OpenCode permits it. Do not claim native OpenCode goal binding unless a primary source proves one exists.

Status: confirmed by user on 2026-06-14.

## D9 - Agent Roster (Confirmed)

LitOpenCode ships two clear primary OpenCode agents and also includes recommended role aliases plus every upstream specialist agent after rebranding/adaptation.

Primary default agents:

- `lit-plan`
- `lit-loop`

Recommended role aliases:

- `lit-architect`
- `lit-forge`
- `lit-oracle`
- `lit-prover`
- `lit-sentinel`
- `lit-librarian`

Specialist agents:

- All upstream specialist roles are retained after OpenCode-native re-authoring and LitOpenCode rebranding.
- `lit-loop`, `lit-plan`, and `lit-implement` remain the primary user-facing OpenCode surface.
- Recommended role aliases and specialist agents are available as advanced/explicit choices, not replacements for the three-agent primary flow.
- No upstream specialist name that conflicts with the guarded-token or brand-clean policy may ship unchanged.

Status: confirmed by user on 2026-06-14.

## D10 - Scanner Policy

LitOpenCode uses a fail-closed scanner patterned after LitClaude:

- Self-immune token construction.
- `git ls-files` plus untracked-non-ignored coverage.
- Zero-exception token scanning: retained provenance, specs, tests, docs, and payloads must not carry raw guarded terms.
- The source allowlist file is schema-only and must stay empty; non-empty entries fail closed.
- CI fails on guarded hits, allowlist faults, scanner faults, or payload leakage.

`opencode` is never a legacy token.

## D11 - Guarded Token Set

Guarded legacy and provenance terms must not appear in product, shipped, or public documentation surfaces. The guarded vocabulary is maintained in the scanner implementation and allowlist policy rather than being copied into docs.

Internal specs may describe the policy using neutral labels only. Any temporary diagnostic use must be assembled outside tracked files, redacted in saved evidence, and excluded from the published payload.

## D12 - CI and Release Safety

CI must be no-publish:

- `permissions: contents: read`
- No publish job.
- No publish secrets.
- Tests, typecheck, scanner, version lockstep, dry pack, payload guard, and plugin validation.

No `npm publish`, `git push`, tags, or history rewrite without explicit user authorization.

## D13 - Documentation Set

Required docs before implementation completion:

- `docs/spec/litopencode-decisions.md`
- `docs/migration.md`
- `plans/litopencode-rebrand-sdd.md`
- `HANDOFF.md`
- Release checklist or release section in the SDD plan.

Visible static skills must live under `skills/*/SKILL.md` and cover workflow loop, durable litgoal, agent roster, start-work, review-work, reference benchmark claims, native goal verdict, doctor installer, search workflow ideas, public-source fetch, release guardrails, text naturalization, litwork activation, and tool guards. These files are documentation and discovery surfaces only; they do not execute dynamic instructions.

## D14 - Published Payload

Published payload must exclude local state, evidence, planning-only provenance docs unless explicitly allowed, tests/fixtures, `# REFERENCE`, and agent runtime state. Payload guard must prove this from `npm pack --dry-run --json`.

## D15 - Version Lockstep

Every version-bearing file must match `package.json`. The exact file set is defined during package scaffolding and enforced by `check:version`.

## Execution Gate Status

All initial execution-gate decisions are confirmed. W0 through W5 and FV-ALL-style gates are complete. Public docs cite reproducible commands rather than local maintainer evidence paths, because local evidence directories are untracked runtime state.
