# Autoconference Resume — Fail-Closed Checkpoint Recovery

## OpenCode authority envelope

This document is inert guidance. `lit-plan` must approve the finite root-owned recovery point,
remaining budget, roots, packet schema, and stale-state response before any mutation or delegation,
including interactive runs. Only explicit `/start-work` may consume that approval. Children remain
depth-one and packet-only; children must not write or mutate root-owned state, select models, or
invoke routes.

Resume is root-owned and read-first. It never starts a fresh conference, invents child output, or
uses destructive git recovery.

## Recovery procedure

1. Locate the approved conference root. Require regular `conference.md` and
   `conference_events.jsonl` files inside that root; reject symlinks, special files, and escapes.
2. Parse every bounded JSONL event in order. Reject malformed lines, duplicate event identities,
   non-monotonic rounds, a phase after completion, or state newer than the current lifecycle revision.
3. Reconcile root TSV rows, researcher packets, poster packets, review packets, and synthesis outputs
   against events. Extra artifacts are stale or foreign until independently reviewed.
4. Compare current goal, evaluator, budget, allowed roots, repository baseline, dependency inputs, and
   task capability with the last checkpoint. A mismatch is `BLOCKED_STALE_CONFERENCE_STATE`.
5. Determine the first incomplete phase. Completed phases are immutable receipts and are not rerun.
6. Present the recovery point, accepted partial packets, rejected artifacts, remaining budget, and
   required authority to the user. Resume only through the trusted `/start-work resume` boundary.

## Re-entry matrix

| Last accepted receipt | Re-entry |
| --- | --- |
| conference initialized, no round | Phase 1 of the recorded round |
| some researcher packets accepted | Phase 1 for incomplete lanes only |
| poster packet accepted | Phase 3 peer review |
| review packet accepted | Phase 4 knowledge transfer |
| round completed | convergence check, then next approved round |
| convergence accepted | synthesis |
| conference completed or cancelled | no re-entry |

Before any re-entry, verify real OpenCode task capability again. If it is absent or denied, emit
`BLOCKED_MULTI_AGENT_UNAVAILABLE`. Children remain depth-one and packet-only after resume.

## Partial writes and interruption

Do not truncate user files or replace version-control state automatically. Quarantine an unreceipted temporary
artifact by reporting it; restoration or deletion needs explicit approved authority. Append a single
`conference.resumed` event only after the lifecycle grant is consumed. Repeated request identities are
idempotent. Cancellation after resume records the latest accepted receipts and stops dispatch.
