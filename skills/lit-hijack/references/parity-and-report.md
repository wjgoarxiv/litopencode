# Parity proof and report

A port is proven by two observations: the capability fires on the surface a user touches, and the new target behaves differently from the old one on the same prompt. Green tests and new files are necessary and fall short of proof. Ports in this product family have passed every gate while sitting unreachable, and A/B runs have measured an empty difference because the baseline could read the treatment; this step exists to catch both.

## 1. Reachability

Drive the real entry point, read what comes back, then break the wiring and watch the probe fail.

| Target surface | Probe | Break it by |
| --- | --- | --- |
| Chat route | Run the `chat.message` hook (or an isolated `opencode run` with a fake provider) on a prompt that should route, and assert the skill pointer appears in the captured request | Removing the route entry |
| Slash command | Run the command hook and read the injected prompt, or run the host and read the transcript | Deleting the command row |
| Skill discovery | An `opencode run` prompt that should load the skill, with the transcript showing the `skill` tool call | Changing the description |
| Script or gate | Run the installed copy's script on a fixture that should fail and one that should pass | Reverting the gate |
| Package payload | Pack the package and list the files (read the JSON listing, since the human listing wraps long paths) | Removing the file from the allowlist |

A probe that cannot fail proves little; record the broken run beside the passing one.

## 2. An isolated baseline

The baseline is the target at the base revision, in a place where the new work cannot be read:

```text
git -C <target root> worktree add <lane folder>/parity-base <base_ref>
```

or the snapshot copied in Phase 0. Check the isolation before running anything: the baseline folder holds none of the new files, `git log` inside it stops at the base revision, and the run folder, the spec and the diff sit outside any path the baseline session can reach. When the target lives in a repo the baseline session could explore, run the baseline from a copy outside that repo.

## 3. Running both arms

Choose prompts the spec never used as examples: a held-out prompt shows the behaviour generalises, while a prompt copied from the spec shows that the spec was followed.

For an OpenCode skill target, run each arm as a real session in its own throwaway workspace. The installed LitOpenCode is switched off for both arms by pointing the profile at a scratch directory, so it cannot add routes, agents or hooks to either side:

```text
mkdir -p <scratch>/{home,xdg/config,xdg/data,tmp}
cd <arm workspace>   # holds .opencode/skills/<id>/ with this arm's copy of the target
env -i PATH="$PATH" HOME=<scratch>/home XDG_CONFIG_HOME=<scratch>/xdg/config XDG_DATA_HOME=<scratch>/xdg/data TMPDIR=<scratch>/tmp OPENCODE_DISABLE_AUTOUPDATE=1 \
  opencode run --pure --model <provider/model> "<held-out prompt>"
```

- Load both arms the same way (a project skill folder in each workspace), so the only difference is the port.
- Use a fresh scratch profile per run. Provider credentials then have to be supplied on purpose, which is why the run waits for the user's approval: it spends the user's model quota.
- Point the workspace at a copy you control, and leave the installed plugin root of the host alone.
- Keep the runs cheap: a small prompt, one model, a few turns.
- Run each arm at least twice when its output varies. One sample can mislead.

For a code target, run the target's tests and its real command on both revisions, and save the outputs.

Save every output under `parity/` (`baseline-1.md`, `treatment-1.md`, …) and list them:

```json
"parity": {
  "baseline_outputs": ["parity/baseline-1.md", "parity/baseline-2.md"],
  "treatment_outputs": ["parity/treatment-1.md", "parity/treatment-2.md"],
  "markers": ["Rejection condition"]
}
```

The parity gate then requires every marker in every treatment output and in every baseline output absent. A marker missing from a treatment output means the port changed behaviour unreliably. A marker in a baseline output means the baseline saw the new work, or the target already had the behaviour and the gap was imaginary. Either way the proof is void until fixed. Before trusting a tie or a surprising win, grep the baseline transcript for the treatment's distinctive identifiers (file names, section names, the skill's own terms); any hit voids the comparison.

## 4. Visual outputs

When the target makes images, films, slides, documents or pages, the user judges them by eye. Render the baseline and treatment outputs side by side on one contact sheet (rows for arms, columns for runs), save it under `parity/`, and show it. Machine checks such as overlap or layout scores are geometry checks; call them that. Headless browsers used for renders take `--use-mock-keychain --password-store=basic` so a keychain dialog never interrupts the user.

The sample output is evidence that the port works. Polishing that one sample is a different task; offer it when the user asks.

## 5. The report

`REPORT.md` lives in the run folder. The gate requires the three headings, every mechanism id, every source's URL or path, and a credit notice for every `ideas-credit` source that fed a taken mechanism.

```markdown
# Port report: <title>

Target: <root> at <base revision> → <new revision or working tree>
Run: .litopencode/hijack/<slug>/ · gate: check --phase report PASS

## Taken
- M1 <title>: <where it lives now> · parity: marker in 2/2 treatment runs, 0/2 baseline runs
- M4 <title>: …

## Left
- M2 <title>: the target already enforces it (<path:line>)
- M3 <title>: opinion with zero gain over the base model in a probe run
- M5 <title>: rests only on S5, which is no-go

## Provenance
| Id | Source | Author | Published | Retrieved | Licence | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | https://… | … | … | … | NOASSERTION | ideas-only |

## Exposure
The spec writer read every source. The implementer worked from SPEC.md in a separate git worktree
(a convention for cooperative agents, since the task tool offers no host isolation), or in the
same context on the degraded path. The model may have met these sources before. The overlap gate
found no run of 12 or more words shared with any capture; headings were checked for structural echoes.

## Credit
<attribution notice path, or "credit lives in this report">

## Review by
<date, and what would make this port stale: a model change, a target redesign, a new source>
```

## 6. Closing the run

1. `hijack.mjs check <run> --phase report` passes.
2. The reply to the user says what was taken and left, the parity result in a sentence, the contact sheet when there is one, and the report path.
3. Offer `review-work` for a work review of the diff; its provenance lane reads the run folder.
4. The run folder stays local and out of commits. Commits, pushes and releases wait for the user.
