A redesign replaces appearance while product behavior stays fixed. Capture the baseline before the first edit; no guard below applies retroactively.

## Baseline capture

Record the current product before touching a file. A later reconstruction is not evidence.

- Enter every affected route, screen, and state into the inventory with an id.
- Render each id at contract viewports and themes, tagged route, state, time.
- Note keyboard order, focus targets, and announcements per interactive surface.
- Note transfer size, LCP, and interaction latency per route on one profile.
- Check dirty-worktree status, never overwrite uncommitted work, hash the baseline.

## Debt map by category

Sort every complaint into one category, then rank by impact times surfaces affected.

- Token debt: hardcoded values, near-duplicate colors, spacing with no name.
- Structural debt: layout that cannot hold real content; nesting that blocks reflow.
- State debt: missing empty, loading, error, or permission-denied states.
- Accessibility debt: failing contrast, invisible focus, unreachable controls.
- Behavior debt: flows the product does badly. Out of scope without separate approval.

## Verdict per surface

Assign one verdict to every inventory surface. An unlabeled surface blocks the redesign.

- Preserve: ships untouched and serves as a parity anchor.
- Change: identical behavior, new visual treatment; needs a baseline pair.
- Replace: new implementation of the same capability; needs behavior tests first.
- Remove: the capability goes away; needs approval, an exception id, and a migration note.
- Store verdict, reason, component ids. Revising one mid-sequence is a scope change.

## Staged sequence

Every stage must be releasable alone.

1. Add new tokens and primitives beside the existing ones, with no visual change.
2. Migrate one low-risk surface end to end, verify parity, keep the old path removable.
3. Migrate the remaining Change surfaces in ranked order.
4. Land Replace surfaces with both implementations renderable behind a flag.
5. Execute Remove verdicts, then delete superseded tokens once no consumer references them.

## Parity list

This must hold identically before and after every stage.

- Each route URL, query parameter, and deep link resolves to the same content.
- Each flow completes in the same required steps or fewer, over the same data shape.
- Permission and auth gates admit and refuse exactly the same users.
- Keyboard order, focus visibility, shortcuts, and announcements unchanged unless listed.
- Locale handling, CJK line breaking, terminal cell width, and performance stay in tolerance.

## Debate without stalling

Bound the discussion; taste arguments do not converge alone.

- State each option as observable consequences: hierarchy, density, motion, states hit.
- Cap it at three options and one round of critique each.
- Decide against the criterion already in the contract, not against preference.
- Still tied: take the option disturbing fewer Preserve surfaces; record the other as considered.

## Regression guards

Guard mechanically whatever a screenshot cannot prove.

- Run the suite before and after each stage; record pre-existing failures, never inherit them.
- Add one focused test per Replace surface asserting preserved behavior, not appearance.
- Assert token usage rather than literal colors; diff route inventory and public props per stage.
- Treat visual comparison as advisory until baseline, renderer, fonts, viewport, tolerance are fixed.

## Closeout

Close on evidence, not a walkthrough.

- Paired baseline and after evidence for every Change and Replace surface.
- The parity list with a pass mark or exception id on every line.
- The debt map with each entry resolved, deferred under an omission id, or rejected.
- Contract hash and baseline hash handed to the independent review pass.

## Failure patterns

Reject a baseline captured after editing, a changed behavior without a verdict, or a dropped capability without approval. Screenshot similarity cannot prove parity, and a contract change cannot turn a loss into intent.
