# Brief format

The collector's `--brief` output is the only format; show it as printed. By default it is the KPI board; with `--detail` the per-session detail follows the board. This file lists every rule behind both so a change to the collector can be checked against them.

## The board, top to bottom

Markdown, labels in the language `--lang` names (`en` by default, `ko` for Korean). Six sections under `##` headings, always in this order, one blank line between them.

1. `## 🎯 Do this now` (`지금 할 일`): one line `**<action>** — <reason>`, then `👉 Type: <exact text>` (`입력`) or, while lanes work, `👉 Wait: until "<lane>" finishes` (`기다리기: "<lane>" 끝날 때까지`). The text to type is `` `go` `` only when the next-step record was written for this session; otherwise the command the step needs (`` `lit approve` or `lit deny` ``, `` `lit continue` ``, `` `start-work` ``) or where to act (`open that session and reply there`). A HANDOFF item says `` tell me to start it; `go` does not run it ``.
2. `## 📊 At a glance` (`한눈에 보기`): a centred four-column table `✅ Done | 🔄 In progress | ⏳ Waiting on you | ⬜ Left` with one row of counts, a blank line, then `Overall  <bar>` (`전체 진행`). With no checklist row anywhere the line reads `Overall  no checklist on record yet`.
3. `## 🏁 Milestones` (`마일스톤`): a table `Milestone | Status | Progress | Last move`. Status is one of `✅ Done`, `🔄 In progress`, `⏳ Waiting on you`, `⬜ Not started` (`끝남`, `진행 중`, `나를 기다림`, `시작 전`). Last move is relative: `just now`, `25m ago`, `3h ago`, `2d ago` (`방금`, `25분 전`, `3시간 전`, `2일 전`). Four rows at most; with more, three rows and a last row `| …and N more | | | |`. Empty: `No open plan or goal`.
4. `## ✅ Done lately` (`최근 끝낸 일`): a bullet list, newest first, five at most. Empty: `Nothing finished lately`.
5. `## ⬜ Still to do` (`남은 일`): a numbered list, seven at most, then `…and N more` (`…외 N개`). Empty: `Nothing left`.
6. `## 🔔 Don't forget` (`잊지 말 것`): five bullets at most, each `- <icon> <thing> → <what to do>`. Empty: `Nothing to remember`.

### How the board counts

- Items are the checklist rows of every plan in the seven-day window, in every worktree of the family, plus the active goal's criteria, plus one item per session question or herdr agent waiting on the user. A start-work boundary does not add an item: its plan's current row is the waiting item.
- A milestone is done when every row is ticked; waiting when its start-work run is paused at a boundary; in progress when its run is active or at least one row is ticked; otherwise not started. Its first open row is counted in progress (or waiting); its other open rows are left.
- `Overall` is done items over all items. Bars are ten cells, `█` filled and `░` empty, the filled count rounded from the share, then `k/n (p%)` with the percentage rounded. `--ascii` draws `#` and `-`. A bar exists only for a real total.
- Done lately: ticked rows (the most recently changed plan first, its later rows first), a completed start-work run in the window (`start-work finished: <plan title>`), passed goal criteria. A row's own numbering (`3.`) is dropped.
- Still to do: open rows of the plan the active or paused run drives, then this worktree's plans by last change, then other worktrees', then open goal criteria.

### Reminders, most urgent first

| Icon | Reminder | Record behind it |
| --- | --- | --- |
| ⏳ | `"<goal>" asks you a question → open that session and answer it`; `"<goal>" waits for approval of <action on dir> → type lit approve or lit deny`; `the agent in pane <id> waits on you → answer it in that pane` | A running `question` tool part, a paused run with a pending boundary, a blocked herdr agent. |
| 🏃 | `<n> lanes still working → don't type go until they finish` | Other working sessions of the family and herdr agents at work, counted once each. |
| 💾 | `<n> uncommitted changes (<worktree>) → review them, then commit or discard` | `git status --porcelain` lines. |
| ⬆️ | `<n> commits not pushed (<worktree>) → push when you are ready` | `git rev-list --count @{upstream}..HEAD`; nothing without an upstream. |
| 🕰️ | `Plan untouched for <n> days: <title> → decide whether to resume or drop it` | An open plan whose file has not changed for seven days; the two most recent at most. |
| 📌 | `HANDOFF.md next: <item> → start it when you are ready` | This worktree's newest open `Next` item, unless it is already the step. |

### What the board never shows

Session ids, commit hashes, raw status words (`waits-on-you`, `idle`, `ended`), plan file paths and other internal paths. A plan is named by its `#` heading. A worktree is named by its folder name only where the reader must open it.

### Size

About forty lines; the fullest case, every list overflowing, is 42. Every line fits in 120 cells.

## The per-session detail, top to bottom (`--detail` only)

Printed under the board after a rule and `## 🔎 Session detail` (`세션 자세히`).

The brief is Markdown, so OpenCode's chat draws it with the theme's colours.

0. The opener, three lines kept apart by a hard break and followed by a blank line: `**Done so far:**` this worktree's newest commits in the seven-day window (two at most), then `` `plans/<name>.md` (start-work complete) `` for a completed run and `` `plans/<name>.md` `<gauge>` `` for a plan with every row ticked, three items in all, else its met goal, else `nothing finished in this window`; `**Doing now:**` the asking session's goal while it works, else `start-work · <plan>` for a running run, else the newest working session's goal, else `nothing running`; `**Next:**` the recommended step, ending in ``(type `go`)`` when a step is armed here.
1. Headline: `## 🧭 <n> sessions · <k> waiting on you · <a> active · next: <short step>`, then one italic line naming the worktree family and how many worktrees had records (and a note when the store could not be read: missing database, old Node). Zero sessions print `No earlier sessions found here.` under the headings.
2. Live sessions (working, waits-on-you, blocked, paused) as full cards, grouped under one `### 🌿 \`branch\` · worktree` heading per worktree, `(this one)` on the worktree the command ran in. Each card is one quote, its lines kept apart by a hard break:
   - a badge (🟢 ACTIVE, 🟠 WAITS ON YOU, 🔴 BLOCKED, ⏸️ PAUSED), the short id, how long ago it last moved, `this session` for the asking one, and the start-work boundary it waits on;
   - the goal in bold;
   - a real gauge in inline code and its source, else ⏳ and the known facts in words (with the pulse for a running session);
   - `✅ Done:` up to three finished items, else the files it edited, else the last sentence the assistant wrote, else the tools it used most (`no edits yet; used Run, Read`);
   - `▶ Next:` the first open todo, else the open plan step, else the open goal criterion, else what a running session is doing now (`now: Run the gates`), else `nothing pending on record`.
3. Ended sessions (done, idle) under `### ⚪ Ended · <n>` as one table, newest first, at most eight rows and an italic count of the rest. Columns: id, where (cut to 20 cells), goal (cut to 44 cells), ago (the largest unit only: `5d`, `14h`, `20m`), done (`finished`, a file count, or `·`).
4. `### 🗺️ Roadmap`: per worktree with something to show, up to three recent commits with their month-day (`✓`), the plan step in hand (`▶ **now**`), up to two steps after it (`○ **later**`); another worktree's lines carry its name in inline code.
5. The box, `Recommended next step`, in a code block with no language tag, so its frame keeps its columns and the chat draws it as plain text: the step wrapped at word breaks to at most three lines, then `type: go` when a step is armed.
6. The closing line: ``Type **`go`** to do it.`` when a step is armed; ``Do not type `go` until they finish.`` while lanes work; otherwise `Nothing runs on its own here: open that session, or say what to do.`
7. When the read budget ran out before every plan was read, an italic line: `<n> plans were not read (read budget used up).` Plans and the other small records are read before the session store, so this happens only with very large plan folders.

## Plans the roadmap leaves out

- An unfilled scaffold: a row still holding a `<placeholder>`, or every row the same.
- Any plan that has not changed in seven days, in this worktree or another.
- A plan with every row ticked: it is finished work and appears in the opener instead.

## Width and glyphs

- Every line at most 120 cells, so a table row never wraps in a 120-column terminal. Hangul, kana and CJK characters count as two cells, emoji as two, combining marks as zero; the collector uses the same width table as the TUI. The box is 72 cells.
- Goals and steps are cut with an ellipsis, never wrapped, except inside the box.
- Data is escaped before it enters the Markdown: `<`, `>` and backticks become look-alike glyphs, and `* _ | [ ] \` are backslash-escaped, so a session title can never open a link, a table cell or emphasis.
- `--ascii` swaps every emoji and box glyph for a plain character (`[*] [!] [x] [=] [v] [o]`, `~`, `v > o`, `+ - |`) and the gauge fill for `#` and `-`.

## The no-filler rule

A gauge exists only for `isRealCount(done, total)`: both whole numbers, total above zero, done between zero and total. Everything else is words. The brief must contain no run that matches `?/?`, `[???]`, `<digits>/?` or two question marks in a row. A real question mark inside a user's own title is allowed; the collector does not add one.

## Redaction

Each string passes `redact()` and then `clip()`: the goal is at most 160 characters, a last action 60, a done or next item 100. Credential shapes become `[redacted]`; the home directory becomes `~`.

## What the model adds

Nothing inside the board or the detail. After them, at most one short line when it helps; the board's own `Do this now` line already names the step and what to type.
