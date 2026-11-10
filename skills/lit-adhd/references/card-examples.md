# Card examples

## The board

The default brief from a fixture worktree with invented facts: two plans in the window (one finished, one half
done), one open plan untouched for twelve days, a session waiting on a question, an idle session, two
untracked files and a `HANDOFF.md` with a `Next` item.

````markdown
## 🎯 Do this now
**Answer the question in "Migrate the billing tables"** — that session is stopped until you reply
👉 Type: open that session and reply there

## 📊 At a glance
| ✅ Done | 🔄 In progress | ⏳ Waiting on you | ⬜ Left |
|:--:|:--:|:--:|:--:|
| 5 | 1 | 1 | 1 |

Overall  ██████░░░░ 5/8 (63%)

## 🏁 Milestones
| Milestone | Status | Progress | Last move |
|---|---|---|---|
| Billing migration | 🔄 In progress | █████░░░░░ 2/4 (50%) | 25m ago |
| Ship the CSV exporter | ✅ Done | ██████████ 3/3 (100%) | just now |

## ✅ Done lately
- docs and gates
- port the exporter
- pin the base
- dry run on a copy
- write the migration

## ⬜ Still to do
1. run it against staging
2. verify the totals

## 🔔 Don't forget
- ⏳ "Migrate the billing tables" asks you a question → open that session and answer it
- 💾 2 uncommitted changes (billing-api) → review them, then commit or discard
- 🕰️ Plan untouched for 12 days: Old dashboard idea → decide whether to resume or drop it
- 📌 HANDOFF.md next: Wire the exporter to the CLI → start it when you are ready
````

What each part shows:

- The step is the same one the detail's box recommends (a question outranks an open plan); the board only words
  it as one action, one reason and what to type. Nothing is armed, so the line names where to act, not `go`.
- Eight items: seven checklist rows of the two plans and the open question. The half plan's current row is in
  progress and its last row is left. The stale plan is not counted; it is a reminder.
- The milestone rows carry the plan titles, never their paths, and the time since each file last changed.
- With `--lang ko` the same board reads `지금 할 일`, `한눈에 보기`, `마일스톤`, `최근 끝낸 일`, `남은 일`,
  `잊지 말 것`, and the reminders read `질문 대기: … → 그 세션을 열고 답하기`, `커밋 안 된 변경 2개 (billing-api) →
  확인하고 커밋하거나 되돌리기`, `12일째 멈춘 계획: … → 이어 할지, 접을지 정하기`.
- When the half plan is the step and the record is written for this session, the step reads
  `**Start the plan "Billing migration"** — 2 steps left` and ``👉 Type: `go` ``. While other lanes work it reads
  `👉 Wait: until "<lane>" finishes`, and a `🏃` reminder says not to type `go` until they finish.

## The per-session detail (`--detail`)

The detail under the board, as the collector prints it with `--detail`, from a fixture store with invented facts. OpenCode's chat draws the
Markdown: the headings, bold status words, emoji badges, inline code and the table come out in the theme's colours.

````markdown
**Done so far:** feat(billing): add the ledger tables; `plans/ledger.md` (start-work complete)  
**Doing now:** Port the exporter  
**Next:** In "Migrate the billing tables", answer the open question.

## 🧭 4 sessions · 1 waiting on you · 1 active · next: In "Migrate the billing tables", answer the open question.
*this worktree family · 1 worktree with records*

### 🌿 `feat/billing` · billing-api (this one)

> 🟢 **ACTIVE** · `a3933725` · just now · this session  
> **Port the exporter**  
> `[▉▉▉▉░░░░░░] 2/5` plan steps · 2 steps · 30m · last: Run the exporter tests  
> ✅ Done: no edits yet; used Run, Read  
> ▶ Next: 3. staging run

> 🟠 **WAITS ON YOU** · `7d920fb3` · 20m ago  
> **Migrate the billing tables**  
> `[▉▉▉▉░░░░░░] 2/5` plan steps · 2 steps · 1h 10m · last: Ask  
> ✅ Done: write the migration  
> ▶ Next: run it against staging

### ⚪ Ended · 2

| id | where | goal | ago | done |
|---|---|---|---|---|
| `0db867f0` | billing-api | 한국어 보고서 초안 정리 | 1d | 2 files |
| `655f39d3` | billing-api | Tidy the parser | 3d | · |

### 🗺️ Roadmap

- ✓ 10-26 · feat(billing): add the ledger tables
- ▶ **now** · 3. staging run
- ○ **later** · 4. totals check
- ○ **later** · 5. cut-over

```
╭─ Recommended next step ──────────────────────────────────────────────╮
│ In "Migrate the billing tables", answer the open question.           │
╰──────────────────────────────────────────────────────────────────────╯
```

Nothing runs on its own here: open that session, or say what to do.
````

What each part shows:

- The opener reads only records: the newest commit, the start-work run that completed its plan, this session's
  goal while it works, and the same step the box recommends.
- The active card has a real total (the single open plan), so it has a bar. It has no edit yet, so `Done` names
  the tools it used most, never a count of calls.
- The waiting card comes from a `question` tool call still open, and the box recommends answering it.
- The two ended sessions are history, one table row each: the age in its largest unit, done as a file count.

## A running session with no known total

```markdown
> 🟢 **ACTIVE** · `a3933725` · just now · this session  
> **Port the exporter**  
> ⏳ 1 step · 30m · last: Run npm test `░▒▓▒░`  
> ✅ Done: tests are green so far  
> ▶ Next: now: Run npm test
```

No bar and no count: the session has no plan, goal or to-do list, so the card says what is known, shows the pulse
and says what it is doing now.

## When nothing can run on `go`

```markdown
╭─ Recommended next step ──────────────────────────────────────────────╮
│ Pick up "Tidy the parser" in billing-api.                            │
╰──────────────────────────────────────────────────────────────────────╯

Nothing runs on its own here: open that session, or say what to do.
```

The box still names a real step from the records. When this worktree's `HANDOFF.md` has a `Next` heading, its
first item comes first (`From HANDOFF.md: Wire the exporter to the CLI`). Only an empty window says "say what to
start".

## A finished run and an idle session

```markdown
| id | where | goal | ago | done |
|---|---|---|---|---|
| `run0a1b2` | billing-api | Run the ledger plan | 10m | finished |
| `quiet9c8` | billing-api | Answer a question about the card | 1m | · |
```

The session that completed the start-work run reads done and names no next step, even though its to-do list
still held an item. The second one moved a minute ago, but its liveness record says idle, so it is listed as
ended rather than drawn as an active card.

## `--ascii`

The same brief with `[*]`, `[!]`, `[=]`, `[x]`, `[v]`, `[o]` for the badges, `~` for the hourglass, `v > o` on the
roadmap, `+ - |` for the box and `#`/`-` in the bar. No emoji, no box glyph.
