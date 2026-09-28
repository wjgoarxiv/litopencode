A capture is evidence only when someone else can reproduce it from its recorded metadata. Settle the channel, its invalidating conditions, and its blocked outcome before opening a renderer.

## Capture record

Record these per artifact, or the artifact is an image with no standing.

- Identity: capture id, contract hash, source revision, inventory id and kind.
- Environment: viewport, dpr, os, runtime, version, font set, locale, colour scheme.
- Determinism, ownership, integrity: reduced-motion flag, settling statement, auth owner, process owner, source hash, capture hash.
- Material input: one direct-child label paired with one caller-authorized, already-open descriptor. Nested labels and root-path-only input are rejected because portable Node cannot bind lexical child opening to a trusted directory descriptor. The evaluator reads, identity-checks, and closes the supplied descriptor; it never reopens the label. Every inventory/check pointer must resolve through the exact descriptor set to regular bytes with its declared hash.
- Immutable manifest: `evidenceManifestBytes` must be the deterministic canonical bytes of the exact manifest object being evaluated. Unrelated bytes cannot pass merely because smoke has no review receipts.
- Contract policy: the capture source hash must equal the frozen Design Contract source hash; each required channel needs a materially verified check whose status is `pass` (`not_applicable` is not coverage), and smoke cannot waive `independent_review_required`.

## Web surfaces

Capture the agreed route at the agreed state, not whatever the renderer settled on.

- Capture full-page and viewport-clipped frames per declared route, region, and state kind, covering loading, empty, error, permission, offline, disabled, and ready separately.
- Freeze data: fixed fixtures, fixed clock, no live counters, no randomised ordering.
- Invalid on a silent font fallback, mid-flight animation, content overlay, undeclared viewport, or a hash that misses the bytes on disk.
- No callable renderer is `BLOCKED_RENDERER_UNAVAILABLE`. An unproven pid, command, project root, or session scope is `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`: do not attach, do not terminate.

## Terminal and TUI surfaces

Capture the byte stream and the grid; a terminal screenshot hides the cell math.

- Capture raw output plus declared rows and columns at minimum, default, and maximum size, recording border topology, truncation points, colour-disabled rendering, and focus movement.
- Treat control and OSC sequences as inert text; keep the sanitised copy.
- Invalid when width was counted in characters, size came from the host terminal, or a sequence ran instead of being recorded.
- No pty renderer or size control is `BLOCKED_RENDERER_UNAVAILABLE`; name the unblocker instead of resizing the terminal at hand.

## Reference-fidelity work

Compare reference to implementation only through paired, dimension-matched captures.

- Capture both sides at identical width, height, dpr, theme, and locale, recording both hashes; the pair is one artifact.
- Separate structure, typography, colour, responsive, state, and motion comparisons.
- Invalid on differing dimensions, a missing or non-canonical hash, a resized copy, or a score offered instead of the pair.
- No provenance-recorded reference renderer is `BLOCKED_RENDERER_UNAVAILABLE`. Similarity never lifts a missing state, baked-in text, or an accessibility regression to PASS.

## Motion

Capture motion as bounded frames with times attached, never as an impression.

- Capture start, mid, and settled frames per transition, stamped with elapsed milliseconds, plus the settling rule that made the last frame stable.
- Capture the reduced-motion variant of that transition in the same run.
- Invalid on untimed frames, a settled frame taken before settling, or a missing required reduced-motion variant.
- No frame-level renderer control is `BLOCKED_RENDERER_UNAVAILABLE`; one still is not motion.

## Responsive width sweeps

Sweep the declared widths; a device name is not a width.

- Capture every declared viewport, minimum and maximum included, at both declared heights, plus the narrow-height and landscape cases named.
- Record reflow, wrapping, navigation change, overflow, and target size per width.
- Invalid on a skipped width, a sweep stopped at the first pass, or one width at a different dpr.
- No viewport renderer control is `BLOCKED_RENDERER_UNAVAILABLE`; browser zoom is not a width.

## Accessibility channels

Capture each channel on its own; one cannot vouch for another.

- Capture the accessibility tree with roles and accessible names per declared interaction, plus focus-visible frames along the full keyboard path, in order.
- Capture measured contrast and target sizes with the required minimum beside each, plus a status-announcement record per state change.
- Invalid on contrast estimated by eye, focus out of order, or a rule reported as mechanical without running.
- A missing renderer channel is `BLOCKED_RENDERER_UNAVAILABLE`; name it, not just the tool.

## CJK and IME text

Capture the scripts and the composition, not one Latin string.

- Capture the longest declared Korean, Japanese, and Chinese labels per truncating region.
- Capture mixed-script spacing, line breaking, punctuation, vertical metrics, and emoji or variation-selector clusters as graphemes with widths recorded.
- Capture composition in progress, candidate selection, and commit per IME-bearing field.
- Invalid on an absent declared font set, an ellipsis hiding untested overflow, or a commit-only capture.
- No IME or font renderer control is `BLOCKED_RENDERER_UNAVAILABLE`; never approximate CJK with Latin text.

## Authentication-limited surfaces

Reach an authenticated surface only through an approved project fixture.

- Capture with a project-owned test account named in the manifest, covering pre-auth, denied-permission, and expired-session states as evidence.
- Keep credentials out of artifacts, filenames, logs, and findings.
- Invalid on a reused personal profile, cookie jar, or storage state, or auth persisted after the run.
- No approved fixture is `BLOCKED_AUTH_UNAVAILABLE`; one that exists but is unsafe to drive is `BLOCKED_TEST_ACCOUNT_UNSAFE`. Narrow scope rather than capture a real login.

## Verdict vocabulary

Return one verdict and keep the two families apart.

- BLOCKED names an absent capability: `BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_AUTH_UNAVAILABLE`, `BLOCKED_TEST_ACCOUNT_UNSAFE`, `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`, `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE`, `BLOCKED_EVIDENCE_STALE`, `BLOCKED_EVIDENCE_FUTURE`, `BLOCKED_CLEANUP_INCOMPLETE`.
- FAIL names a check that ran and rejected the work: a rejecting review verdict or an unaccepted gating finding.
- BLOCKED outranks FAIL: with a capability missing there is no judgement to report.
- REVISE names incomplete evidence inside an available channel, never a missing channel.
- Cleanup closes the run: stop only owned processes, remove only artifacts this run created, list what remains. An incomplete receipt is `BLOCKED_CLEANUP_INCOMPLETE`.

## Failure patterns

Reject:

- A capture without viewport, font set, or capture hash.
- A default-state gallery offered as a state inventory.
- A similarity percentage standing in for paired, dimension-matched frames.
- A FAIL relabelled BLOCKED so the run reads capability-limited, not defective.
- A PASS written while a process this run started is still alive.
