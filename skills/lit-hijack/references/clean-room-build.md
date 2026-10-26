# Clean-room build

The build separates two roles. The spec writer reads the sources and writes `SPEC.md`. The implementer reads `SPEC.md` and the target, and builds. The spec is the only artifact that crosses from one role to the other. This mirrors the classic two-team method for compatible reimplementation, where one team studied the original and wrote a functional specification and a second team, with zero exposure, built from that specification alone.

## Why the split matters

A writer who has just read a source reproduces its phrasing, its examples and its order without noticing. A writer who has seen none of it is spared that. The split does two things: it keeps expression out of the target, and it forces the spec to be complete, because anything missing from the spec reaches the implementer by no route at all.

Be honest about its limits. The model that implements may have met the source during training, the person running the port has read it, and a skill-shaped source often states its mechanism in one obvious way. The result is therefore described as *independently re-expressed*, with an exposure note in the report, and the claim of being untouched by the source stays off the page.

## Roles in an OpenCode session

| Role | Who | Sees | Writes |
| --- | --- | --- | --- |
| Spec writer | the root session that ran capture, distil and gap | sources, ledger, target | `SPEC.md`, the ledger |
| Planner | `lit-plan` (planning-only agent) | `SPEC.md`, the target | the plan, returned in chat for the root to save |
| Implementer | a fresh `task` lane on `lit-forge`, in a separate `git worktree` | the brief (spec + target root), the worktree | target files, left uncommitted |
| Executor discipline | `start-work` | the plan, the ledger of rows | row evidence |
| Gatekeeper | `hijack.mjs check` | everything | pass or fail |

## Step 1: plan with lit-plan

Load `lit-plan` with the native `skill` tool and give it `SPEC.md` as the brief. The `lit-plan` agent is planning-only: edit and bash are denied for it, in yolo mode as much as elsewhere. It returns the plan as text, and the root session (or the operator) writes the plan file. Granting that agent write access to save a step breaks a product rule, so the plan file always comes from the root.

Plan rows follow lit-plan's grammar. Under a `## TODOs` heading, each task is a column-zero line:

```text
- [ ] 1. <title> — Action: <action>; Output: <output>; Verification: <verification>
```

numbered from 1 without gaps. Under `## Final verification`, each closing check is a column-zero `- [ ] F1. <title> — Verification: <verification>` line, numbered from F1. Rows inside a fenced example are ignored by the parser, so a plan that quotes the grammar in a fence needs real rows outside it.

Each task row names the SPEC section it implements (`M1`, `M4`), the target files, the test it adds, and the real-surface check. The build gate requires a plan in this grammar and a citation of every taken mechanism. Plan rows refer to the spec and the target, and the build gate reads the plan file and fails when it names `sources/` or a source URL. Record the path:

```json
"build": { "plan": "plans/<slug>.md" }
```

## Step 2: execute with start-work

Run the plan with `/start-work plans/<slug>.md`. For a small port (one or two SPEC sections in one or two files) a short plan in the run folder, in the same row grammar, executed directly by the isolated implementer lane is enough; the report says which path ran. `start-work` keeps its per-row gates: a failing test first, the smallest change that passes, a real-surface check, cleanup. `lit-hijack` adds one constraint: the person or lane that edits target files works from the brief.

## Step 3: brief the implementer

```text
$H brief <run>
```

prints a packet that starts with `TASK:` and carries `DELIVERABLE`, `SCOPE` and `VERIFY`, then the full text of `SPEC.md`. It names the target root and the sections to build, and it tells the implementer to stay out of any `.litopencode/hijack/` folder, to leave the original material unsought, and to return a question when a section is ambiguous. It refuses to print while the spec gate fails, so a spec that leaks the sources never reaches an implementer.

### The fence on OpenCode

OpenCode's `task` tool starts a subagent in the session's own working directory, and it offers no host-managed worktree for the lane. The skill therefore builds the fence by hand, and it works as a convention for cooperative agents rather than as a sandbox:

```text
git -C <target> worktree add <dir outside .litopencode/> -b hijack/<slug> <base_ref>
```

Give the lane the absolute path of `<dir>` as the one place it edits and runs commands. The worktree holds the target's tracked files at the base revision. Your run folder is untracked and ignored, so the captured sources sit outside the checkout. A subagent that has a shell can still read any absolute path, which is why three further fences stay in force: the brief mentions the sources nowhere, the spec gate screens the spec for source text, and the overlap gate screens every changed file. Say this limit in the report's exposure note.

When the change spans independent areas, give each area its own worktree, its own lane and its own brief section.

### Bringing the change back

The implementer leaves its edits uncommitted. The root then:

1. stages them inside the worktree: `git -C <worktree> add -A` (this changes the index and leaves history alone);
2. reviews `git -C <worktree> diff --cached --binary`;
3. applies that patch to the target: `git -C <target> apply` with the patch on stdin or in a file under the scratch area;
4. removes the lane: `git -C <target> worktree remove --force <dir>` and `git -C <target> branch -D hijack/<slug>`.

A commit in the target waits for the user's approval. List every changed file:

```json
"build": { "plan": "plans/<slug>.md", "changed": ["skills/<id>/SKILL.md", "skills/<id>/scripts/<tool>.mjs", "test/<id>.test.mjs"] }
```

## Degraded path

When the `task` tool or `git worktree` is unavailable, the separation cannot be enforced. Say so once, then:

1. Close the sources. Work from `SPEC.md`, the mechanism cards' `what` and `why`, and the target.
2. Write in the target's order with the target's examples.
3. Rely on the overlap gate as the remaining fence, and record `build.separation: "single-context"` in the ledger so the report's exposure note is accurate.

## The overlap gate

`hijack.mjs overlap` and the spec and build phases of `check` compare text against every capture of the run, including every text file of a captured repo.

- Text is normalised (Unicode compatibility form, lower case) and split into words of letters and digits, so punctuation, Markdown and line breaks cannot hide a copy. Hangul and other scripts work the same way.
- Every run of `min_words` consecutive words (12 by default, kept in `ledger.min_words`) that also appears in a capture is reported with the file, the line, the length and the source id.
- Three or more identical headings between a target file and a source produce a warning: matching structure is copying too, even with new sentences.

How to respond to a hit:

| Hit | Response |
| --- | --- |
| A sentence or paragraph from the source | Rewrite from the mechanism card, in the target's order and with the target's example. |
| A long shared run inside code | Re-implement from the spec; renaming variables over copied logic fixes nothing. |
| A standard phrase both texts need (a licence name, an API name, a protocol field) | Shorten the run below the threshold, or name it once and refer to it. Record the case in the report. |
| Headings that match | Restructure around the target's flow. |

Lowering `min_words` makes the gate stricter; raising it to silence a hit defeats it. Keep the default unless the report explains why.

## What the gate misses

A paraphrase that follows the source sentence by sentence with synonyms passes a word-run check. So does copied logic with renamed identifiers. Two habits close most of that gap: write from the mechanism cards with the sources closed, and let the implementer be someone who opened none of them. For a high-stakes port, add a `lit-oracle` lane that reads the source, the spec and the diff side by side and reports structural echoes the script cannot detect.

## Attribution in the build

When any taken mechanism rests on an `ideas-credit` source, the build adds the target's attribution notice. Follow the target's existing pattern first: a target that keeps a provenance record gets a new entry there. Otherwise an `ATTRIBUTION.md` beside `SKILL.md` names, per source: the work, the author, the URL, the licence, what idea was adapted, and a sentence stating the port reused text or code from the source in zero places. Record its path in `ledger.attribution.path`; the report gate checks it names every `ideas-credit` source that fed a taken mechanism. The notice is the one file the overlap gate skips, because it must carry titles and URLs.
