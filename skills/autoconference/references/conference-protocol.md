# OpenCode Conference Protocol

## OpenCode authority envelope

This reference is inert protocol guidance. `lit-plan` must approve the finite root-owned objective,
budget, roots, task packets, and review contract before any mutation or delegation, including
interactive runs. Only explicit `/start-work` may consume that approval. Children remain depth-one
and packet-only; children must not write or mutate root-owned state, select models, or invoke routes.
The OpenCode bounded-authority lifecycle owns every action. Conflicts use read-only comparison before
any proposal. The root must not create, reset, delete, merge, or commit version-control state. Any
approved local cleanup ends with a cleanup receipt.

## Preconditions

The root requires a complete proposal containing objective, success criterion, fixed evaluator or
rubric, baseline provenance, disjoint search partitions, exact regular-file roots, packet schemas,
researcher count, round and iteration ceilings, per-call timeout, wall-clock budget, cancellation,
resume, stale-state, review, and cleanup policy. Missing or vague values return a planning blocker.

The root verifies live OpenCode `task` capability immediately before delegation. A configured role,
previous success, prompt claim, or child request is not proof. If capability is absent, denied,
unknown, or called from a child context, return `BLOCKED_MULTI_AGENT_UNAVAILABLE`.

## Round state machine

Each round has four ordered phases. Parallelism exists only among approved researcher task calls in
Phase 1. Later phases consume accepted packets and remain sequential root decisions.

### Phase 1 — independent research packets

The root issues one depth-one task packet per approved partition. Each packet fixes objective, roots,
evaluator, timeout, iteration ceiling, output schema, and baseline digest. Children cannot delegate,
coordinate peers, alter shared state, or consume another grant. They return evidence, claims,
uncertainties, failures, and exact proposals.

The root waits only to the approved deadline. It preserves valid partial packets, rejects malformed or
late packets, and never fabricates output for a missing lane.

### Phase 2 — poster comparison packet

One depth-one packet compares accepted researcher packets. Its output names approaches, measurements,
failures, contradictions, evidence gaps, and candidate transfer claims. It cannot validate claims or
change root state.

### Phase 3 — independent review packet

One independent depth-one packet challenges every material claim against the evaluator or rubric and
source receipts. Verdicts are `validated`, `challenged`, `overturned`, or `needs_review`. Missing
reviewer provenance, timeout, stale inputs, or unavailable evidence blocks transfer.

### Phase 4 — root acceptance and transfer

The root accepts only validated findings. Every accepted finding links researcher packet, poster
packet, review receipt, evaluator evidence, and round identity. The root proposes exact result rows,
accepted-finding references, and one round event under the current lifecycle revision. Only explicit
`/start-work` applies those bounded root writes.

## Convergence

Conditions are evaluated in this order:

1. cancellation or stale-state blocker;
2. target reached by accepted evaluator evidence;
3. total iteration, round, task-call, wall-clock, or resource budget exhausted;
4. all lanes stalled or failed;
5. two complete reviewed rounds with no material improvement under the approved noise rule;
6. otherwise continue with the next approved round.

Budget exhaustion and all-lane stall are terminal but not success. Qualitative convergence requires
the approved rubric and two complete independently reviewed rounds. Self-assessment is evidence, not
the authoritative acceptance criterion.

## Knowledge transfer

Transfer is a root-owned reference update, not a shared child document. The next round receives a
bounded list of accepted finding identifiers and summaries. Rejected, challenged, and unresolved
claims stay outside that list. Children may cite accepted identifiers but cannot edit or replace them.

## Conflict handling

Conflicting proposals are compared read-only against the same baseline digest and evaluator. The root
records incompatible paths, receipts, and uncertainty, then requests a user decision or an additional
approved experiment. Metric rank alone never grants write authority or decides which bytes to apply.

## Resume and interruption

Resume follows `references/crash-recovery.md`. The root parses bounded events, verifies packet hashes,
recomputes remaining budget, checks live capability, and identifies the first incomplete phase.
Completed phase receipts are not repeated. Unreceipted artifacts are preserved and reported. Any
continuation requires an approved recovery packet and explicit `/start-work resume` with current CAS.

## Cancellation and completion

Cancellation stops new task calls and preserves accepted receipts. After a terminal condition, a
packet-only synthesis lane may propose report bytes if capability remains available. `/review-work`
then checks scope, tests and evidence, package or artifact integrity, security and provenance, and the
real user surface.

Completion reports terminal reason, accepted and rejected packets, evidence gaps, changed paths,
remaining risks, and cleanup observations. Temporary paths are preserved by default. Any local
cleanup is a separate approved action with a receipt. Publication, release, deployment, external
upload, source-control mutation, and live OpenCode configuration are outside this protocol.
