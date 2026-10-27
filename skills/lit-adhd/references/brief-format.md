# Brief format

The collector's `--brief` output is the only format; paste it as printed. This file lists every rule behind it so a change to the collector can be checked against them.

## Layout, top to bottom

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
6. The closing line: ``Type **`go`** to do it.`` when a step is armed; otherwise `Nothing runs on its own here: open that session, or say what to do.`
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

Nothing inside the brief. After it, the model says in one line which step the box recommends and whether `go` is armed.
