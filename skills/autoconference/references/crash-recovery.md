# Root-Owned Crash Recovery Matrix

## OpenCode authority envelope

This reference is inert recovery guidance. `lit-plan` must approve the finite root-owned recovery
point, remaining budget, roots, packet schema, and stale-state response before any mutation or
delegation, including interactive runs. Only explicit `/start-work` may consume that approval.
Children remain depth-one and packet-only; children must not write or mutate root-owned state,
select models, or invoke routes.

Recovery is read-first and fail-closed. The root reconciles regular files, bounded event lines, packet
identities, hashes, lifecycle revision, and remaining budget. It never assumes that an absent event
means an action failed, and it never treats an unreceipted artifact as accepted state.

## Common diagnosis

Before proposing recovery, the root performs only approved reads:

1. parse `conference_events.jsonl` in order and reject malformed or non-monotonic records;
2. locate the last complete phase receipt for the current work and round;
3. compare packet identities and hashes with root result rows;
4. classify extra or partial artifacts as unreceipted rather than deleting them;
5. compare goal, evaluator, roots, baseline digest, dependency inputs, and lifecycle revision;
6. verify real OpenCode task capability again before proposing another child call;
7. calculate the exact remaining round, iteration, wall-clock, and task-call budget.

Any mismatch that changes meaning returns `BLOCKED_STALE_CONFERENCE_STATE`. Missing task capability
returns `BLOCKED_MULTI_AGENT_UNAVAILABLE`. Diagnosis itself writes nothing.

## Recovery type 1 — interrupted researcher packet

**Signal:** a round-start receipt exists, but one or more approved researcher packet identities have no
terminal receipt.

**Proposal:** preserve accepted packets, mark unresolved identities as incomplete in the recovery
packet, and offer either redispatch of only those identities or continuation with explicitly partial
evidence. The user approves one option through `lit-plan`; explicit `/start-work resume` consumes it.

The replacement call receives a new packet identity and the same approved partition, evaluator,
baseline digest, and remaining budget. Partial child output remains evidence but cannot be merged with
the replacement packet without reviewer reconciliation.

## Recovery type 2 — interrupted poster packet

**Signal:** all intended researcher packets are terminal, but there is no accepted poster receipt.

**Proposal:** leave any unreceipted poster artifact untouched, identify it in the recovery report, and
issue a fresh poster packet using the accepted researcher packets only. The root accepts the new packet
only after schema, identity, and hash checks.

## Recovery type 3 — interrupted reviewer packet

**Signal:** an accepted poster receipt exists, but material claims lack an accepted review receipt.

**Proposal:** preserve the poster packet, classify any partial review artifact as unreceipted, and issue
a fresh independent reviewer packet with the same rubric and evidence map. Knowledge transfer remains
blocked until the root accepts the review packet.

## Recovery type 4 — interrupted root transfer

**Signal:** an accepted review receipt exists, but root result rows, accepted-finding references, and
the round-complete event do not agree.

**Proposal:** derive an idempotent transfer set from accepted packet and review identities. For each
candidate root write, record expected prior digest, proposed resulting bytes, and the event identity to
append. Do not apply any part during diagnosis. Explicit `/start-work resume` applies the exact approved
set with current CAS revision or stops stale.

If a proposed prior digest no longer matches, preserve current bytes and return a conflict packet. Do
not guess which version is newer or more valuable.

## Recovery type 5 — interrupted synthesis

**Signal:** a terminal conference reason is accepted, but no accepted synthesis packet and completion
receipt agree.

**Proposal:** preserve all round receipts and any unreceipted report artifact. Issue a fresh synthesis
packet containing only accepted findings, review verdicts, terminal reason, and report schema. The root
may finalize proposed report bytes only through the active approved lifecycle.

## Idempotency and replay

- Completed phase receipts are immutable inputs and are not repeated.
- A request identity replay with identical payload is idempotent; reuse with different payload fails.
- A stale lifecycle revision cannot apply a recovery packet.
- A late child packet cannot satisfy a newer identity.
- Missing evidence remains missing; recovery does not reconstruct it from prose.
- Cancellation is terminal for the current work and stops new dispatch.

## Recovery output

The read-only recovery report names:

- work identity, round, last accepted phase, and current lifecycle revision;
- accepted, partial, missing, malformed, late, and stale packets;
- remaining finite budget and capability verdict;
- exact proposed root actions and their expected prior digests;
- paths preserved without change;
- the explicit `/start-work resume` command boundary or a blocker.

Temporary and user-owned paths are not removed automatically. Cleanup is a separately approved local
proposal after recovery or cancellation, followed by a receipt listing removed, preserved, absent, and
blocked paths. No recovery path grants publication, release, source-control mutation, or live-profile
authority.
