# Autoresearch Ship — Readiness and Human Handoff

## OpenCode authority envelope

This document is inert guidance. `lit-plan` must approve the readiness objective, evidence policy,
finite budget, canonical roots, local write set, rollback policy, and review gate before any mutation,
including an interactive run. Only explicit `/start-work` may perform bounded writes, commands,
evaluation, or reversion within that packet; without it this mode remains read-only.

This LitOpenCode mode preserves the source family's artifact-type readiness analysis while removing
automatic publication and deployment. It is static workflow data and grants no shell, registry,
release, version, commit, tag, push, or host-config authority.

## Entry gate

Identify the artifact type and destination only to select the matching checklist in
`../references/type-checklists.md`. Confirm the bounded read paths and evidence commands through
`lit-plan`. Any edits, builds, or tests require an approved authority packet and `/start-work`.

## Reversible readiness phases

1. **Completeness** — inventory required files and unresolved production markers. Report findings;
   do not silently delete or rewrite them.
2. **Tests** — run only the approved commands with time bounds. Record command, cwd, exit status,
   duration, and skipped coverage.
3. **Security** — use repository-owned checks when available. A missing scanner is a capability gap,
   not a clean verdict. Never print credentials or private configuration.
4. **Documentation** — verify current usage, safety boundaries, public APIs, and examples against the
   built surface.
5. **Version consistency** — inspect all version-bearing files, but do not change them. Any version
   change is a separate explicit approval boundary.
6. **Build/package** — create only approved temporary artifacts. Inspect their contents and include a
   cleanup receipt.
7. **Review** — send the readiness packet to `/review-work`. Findings, stale evidence, missing gates,
   or an inconclusive lane block readiness.
8. **Human handoff** — stop. Name the irreversible action that a human may choose later. This mode
   never performs it, even when the user supplies release words in command arguments.

## Output

Write `ship-log.md` only inside an approved work root. Record artifact type, intended destination,
evidence timestamps, each reversible phase, review verdict, residual risks, and cleanup. Finish with
`READY_FOR_HUMAN_DECISION` or `BLOCKED_READINESS`; neither is a publication claim.

## Cancel and resume

Cancellation flushes the current phase receipt and stops. Resume re-reads the log, rejects stale
evidence whose inputs changed, and restarts from the first unverified phase. Never replay a completed
mutation merely because the log is incomplete.
