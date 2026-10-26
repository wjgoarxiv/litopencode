# Changelog

Notable user-visible changes are recorded here. Registry and Git release operations
are tracked separately from this product history.

## Unreleased

- `lit-hijack` captures and `lit-typographic-motion` asset fetches now connect to the address their hop check approved, so a name that answers again with a private address (DNS rebinding) cannot redirect the connection; TLS still verifies the certificate for the name.
- Hardening from an independent review: `lit-hijack` captures and `lit-typographic-motion` asset fetches check every redirect hop for a public host (no localhost, private network or metadata address), follow at most five redirects and stop reading a body at its cap; a GitHub tree link must name a plain ref and a folder inside the clone. Both redactors catch credentials written as quoted JSON keys, and the brief also redacts URL-encoded and base64 forms of secret environment values. The mission card drops terminal escape and control sequences from record text, `brief.md` is replaced through a rename instead of written through a link, and `go` after a brief whose step belongs to another session now says where to act instead of doing nothing.
- `lit-typographic-motion` films now take one of four house styles (`swiss-signal`, `tidal`, `terminalcore`, `paper`) kept as data: palette, faces, type scale, motion and sound beds. The pick follows the request, then the folder's `motion-house.json` (written by the first film that passes), then keywords and genre; an explainer takes `paper`. Each stage shot sits on a layout grid (`layout`, `hero`, `transition`), `render.mjs scaffold` writes the starting page, and `render.mjs stage --stills-only` now draws a storyboard (`stills/board.png`) and checks the layout before any film is encoded: overlapping text (also around cuts), text off the style, text outside its zone, flat frames and dead air all fail. `render.mjs styles` draws one board per style, and a request for a preview is done at the board.
- `lit-typographic-motion` films are now rich by default: the treatment's `register` is `rich` unless the request asks for a calm or minimal film, a rich stage film must fill its frame (new `RICH-FILL` gate row), and its sound is a per-film layered score (`sound.mode: score`) built in the product's own code: seeded by the film, a genre from the house style, stems for kick, clap, hats, perc, bass, chords, lead, fx and accents kept as files, a sidechain, the drop on the story beat, -16 LUFS with a -2 dBFS limiter. `render3d: "blender"` adds an optional Cycles plate rung (`render.mjs blender`, a `BLENDER:` line from `scaffold`, a labelled fall back to three.js when Blender is absent, and a Blender line in the motion doctor probe). The stage look round gains two questions (rich enough for its register, does the turn land) and the cover a ninth, `gate.mjs --done` finds the run up the tree so `--out .` works inside the film folder, and the skill asks one `question` for path, style, format and register before the treatment.
- `lit-typographic-motion` stage films now carry a story (what is expected, the turn, the shot where it lands, the payoff) and a protagonist that acts across the film. A link in the request makes the product required: `render.mjs assets --out <dir> --url <https link> [--cover]` fetches its images as untrusted data (sniffed, size-capped, SVG cleaned, badges skipped; Node fetch only), the new `ASSET-USED` gate row fails a film that never shows them, and an unreachable product exits 22 and asks the user. `depth: "3d"` draws with the vendored, hash-pinned three.js r170 on the GPU rung (`--use-angle=metal`) with a labelled SwiftShader fallback, and a README cover without user art takes the new `hero-3d` recipe (`painted-light` needs user art, `hero` and `beat` are required).
- The GitHub README has a What you can make gallery: a real `lit-adhd` brief, a `lit-pptx` deck, a `frontend-ui-ux` page and a `lit-schematic` P&ID, each rendered on this host and kept out of the npm package.
- The `lit-adhd` brief is now Markdown, so OpenCode's chat draws it in colour: a coloured badge per live session (🟢 active, 🟠 waits on you, 🔴 blocked, ⏸️ paused) in a quoted card, ended sessions folded into one table row each (at most eight, every row on one line in a 120-column terminal), the roadmap and the boxed step. The box always recommends a real step from the records when nothing can run on `go`: another running session with what it is doing now, an open plan in another worktree, or the most recent session that stopped. A card with no edit yet names the tools it used most, and the roadmap leaves out unfilled plan scaffolds and another worktree's plans untouched for a week. While the brief is read, the band draws the LIT pill, the running phase and the `lit-adhd` chip cell by cell through the colour cycle, and the phase labels and the context figure turn too. The colours change only on fixed cells, so the flash limit and the motion setting work as before.
- The lit-adhd look on the mission band now lasts while you read the brief: until your next prompt, for at most fifteen minutes. The top border shows a REWIND « mark with a colour per letter and a moving sparkle trail, all at one brightness, and it stays off when TUI motion is off or NO_COLOR is set. The idle band suggests `lit adhd` only in a fresh session or after a 30-minute break, the start suggestion appears at most once a day per workspace, and lit-handoff now points to lit-adhd.
- The design skills now ask before they build. `lit-pptx`, `lit-docx`, `frontend-ui-ux`, `lit-schematic`, `lit-diagram-drawer`, `readme-studio` and `lit-typographic-motion` show OpenCode's question picker with two to four looks, the recommended one first, unless your prompt already names the look or says "you choose". A run that cannot ask, such as `opencode run`, takes the recommended look and says so in one line.
- `lit-hijack` ports the mechanism in someone else's published work into your own skill or system. Give it X posts or long articles, repos, gists, blog posts, PDFs or transcripts and a target; it captures each source with its author, date and licence, keeps only the technique and none of the wording, compares it with what your skill already does, writes a spec free of source text, has a separate subagent build from that spec in its own git worktree, and checks that the new skill behaves differently from the old one before writing a report of what was taken and left. A bundled `hijack.mjs` decides when each phase is done and refuses the implementer's brief while the spec still echoes a source. Use `lit hijack <url> into skills/<name>`, `lit 하이재킹 …` or `/lit-hijack`.
- `lit-adhd` (alias `lit-rewind`) picks the work back up: a read-only collector reads the earlier sessions of this worktree family (the session database opened read-only, else the older JSON store, plus plans, goals, the bounded run, workflow stacks and `git log`) and prints one brief with a status per session, a gauge only for a real total (otherwise the known facts in words), what is done and next, a roadmap and one boxed recommended step that a bare `go` follows for 30 minutes. A long discipline interrupted by another lit command is now paused with its stage and count instead of replaced, and `lit continue` or `go` returns to it. Typed `start-work [plan]`, `lit approve` and `lit deny` drive the bounded run without pasted JSON; `lit deny` ends the run, because the run lifecycle has no refused-and-still-paused state. Every printed string is redacted and no placeholder such as `?/?` is ever shown.
- The band shows parallel lanes under the skill row (workflow-stack frames, running `task` calls and other sessions here, four at most then `+N more`) with a gauge only for a real total and known facts plus a pulse otherwise, plays a constant-lightness colour cycle while `lit-adhd` runs (off under `motion: false` and `NO_COLOR`), says `lit adhd to pick up where you left off` when earlier work exists, and raises one toast for a fresh session in such a workspace.
- `frontend-ui-ux` locks the look before it builds a new page or screen: one of five house styles (`field-notes` for landing pages and other read-once pages, `graphite` for dashboards, settings and data-dense screens, and `meadow`, `computational-brutalism` and `neo-brutalism` only when the request asks), one layout (landing, workspace or settings) and one signature moment. `scripts/design-lock.mjs` writes `design.lock.json`, `ui/tokens.css`, a token-only component sheet, the layout starter and the fonts into the project, and the probe checks the rendered page against the lock (DS-001 to DS-008) and prints six LOOK questions to answer on the screenshots. Pages are rich by default: up to four accent hues, one gradient headline, glows and layered motion; a request for minimal or calm locks the quiet register. A request such as "lit build a landing page for a kayak rental" now reaches the skill with the lock step, while building a Grafana dashboard or a backend API stays out. `probe.mjs --viewports` runs a subset of the matrix and never approves.
- `lit-schematic` draws real equipment: a P&ID with ISA-5.1 tags, symbols, control loops and a legend sheet, a PFD, a journal apparatus figure at exact column widths, and an isometric cutaway in full material colour. It writes editable SVG, vector PDF and 600 DPI PNG, a cutaway can also come as an interactive page or a short MP4, WebP and GIF loop, and a QA script plus a mandatory look at the render check the result. Pick it from the skill picker, or end a clear request to draw a P&ID, PFD, apparatus or cutaway with `lit`.
- Diagrams are denser by default: `lit-diagram-drawer` aims for about fourteen to twenty-four nodes in named zones with three to five colour families, and its accent check now fails at six families instead of four. `lit-scientific-visualization` adds a light grid, direct labels, insets and multi-panel context by default. Ask for a minimal figure and you get one.
- `lit-pptx` has five more design directions, for thirteen in all: computational brutalism for engineering reviews (JetBrains Mono figures and titles over Pretendard Hangul, a grid of page marks), neo-brutalism for launches and pitches (heavy edges, hard offset shadows), Bauhaus for design talks, riso for community programmes and a newsroom look for public-data briefings. Each has its own sheet, a Korean worked example and display devices. Name a style in the request and the skill builds in it.
- Every `lit-pptx` direction now sets titles and body on one slide grid, so changing the direction changes the look and never the place. A title style (rule, band, rail, large, statement, numeral, bottom rule) now dresses the one title frame instead of moving it, the gate checks one title frame per kind (OF-113) and that two directions of the same source put titles and body in the same places (OF-116), and the empty-region check (OF-115) keeps only the cases that still apply.
- Decks are richer by default: up to four accent colours on a slide before the gate objects (five fails, OF-101; a pack may only widen that), a large title step on, and grid or geometry decoration through `decoration:` in the front matter. `register: bold` is the only way to the presented type ramp, and `hero: false` calms a deck. Hard offset shadows belong to the packs that draw them and fail elsewhere (OF-120).
- `node <skill>/run.mjs render deck.pptx --out-dir DIR` renders a deck to PDF and page images through LibreOffice and `pdftoppm`, installing the faces the deck embeds so JetBrains Mono and Pretendard show; without LibreOffice it says the visual check did not run. The layout check now measures a title with the tracking and line spacing it sets, so a tight two-line title is no longer called an overflow.
- A deck asked for by its slide count and a style, with no making verb, such as "lit 신규 서비스 투자 피칭 덱 10장, 네오 브루탈리즘 스타일로" or "lit a 10-slide deck in bauhaus style", now loads lit-pptx. "사진 10장 보정" still loads nothing.
- On OpenCode v2 with the command alias files installed, `/lit-adhd` and `/lit-rewind` reach the plugin as the command body without a mark; that prompt now carries the lit-adhd mark and the session note, so the card takes the rewind look and `go` can follow the brief, as on every other route.
- The status card picks its look from one registry: lit-adhd keeps the rewind look on every route, `◆ YOUR TURN` breathes amber while the session waits on you (a permission, a question, a goal decision, a `BLOCKED:` reply or a paused start-work boundary), and review-work splits the top border into its five lanes, lit only as the agent reports each with the new `review-work` `lane` action. The completion sparks still play once when a goal reaches done.
- A subagent lane on the status card now counts as moving whenever its own session writes, so a `task` still working after five minutes stays `working` instead of reading `idle · quiet`; a lane whose session really went quiet still reads idle (dim), and no lane is ever drawn blocked.

## 1.0.31 - 2026-10-26

- The motion and README cover tools pick up upstream fixes in their pinned dependencies: `certifi` 2026.10.19 for motion audio, and newer `hono` and `fast-uri` in the HyperFrames and Remotion template lockfiles. A fresh setup installs these versions; nothing else about how the skills run changes.

## 1.0.30 - 2026-10-22

- OpenCode 2 is supported alongside OpenCode 1. The installer detects either host, and sessions started without a model use the agent’s configured route. Missing routed OpenAI models are added to the catalog. Knowledge notes, resume receipts and handoff replies arrive as user context, and the server and TUI type exports work without importing a host plugin package.

- Repeating `lit` continues the active workflow and keeps its progress. `lit new` and `lit restart` start fresh; a bare `lit` resumes an approved plan or active work. Repeated activations use a short reminder instead of loading the full instructions again.

- `lit-brainstorm` explores an open question, groups and scores options, and asks you to choose before handing the result to an interview or plan. Use `lit brainstorm`, `lit ideation` or `/lit-brainstorm`.

- `litgoal` sets the finish line for `lit-loop` and `start-work`; the old `durable-litgoal` name redirects for one release. `review-work` distinguishes plan review from work review, and either mode can be selected explicitly.

- The motion skill makes seamless animated WebP covers for READMEs and banners, with recipes for relit artwork, moving type and orbiting objects. It checks the decoded animation for motion, seams, contrast and size, supports any machine as the hero, and reports a broken cover page immediately.

- Office setup selects Python 3.10–3.14, and motion audio selects 3.12–3.13, matching their pinned wheels. A newer `python3`, such as 3.15, is skipped. Explicit interpreter overrides are checked on their own, and an unsupported host gets an error naming the interpreters tried.

- Windows command launches handle npm shims, executable extensions, CRLF output and venv paths, and preserve child exit codes. Tool lookup finds `ffmpeg.exe`; PDF profiles check required fonts and load support for long tables.

- The README covers and family artwork now show all seven LitFamily products, with matching text and reduced-motion stills.

## 1.0.29 - 2026-10-19

- The write guard now catches a paragraph that keeps defining a figure by negation. Two Korean definitional negations in one paragraph, list or table column, or three in any language, are refused, and reworded forms such as `~로 읽을 수 없음`, `~와는 다름`, `does not mean` or `must not be read as` count too; exactly two, unless both are Korean, draw a warning. The refusal carries the fix: say what the figure is first, then give the caveat once, for example "18,420 visits in total, including repeat visits". A limitation stated once, short table cells such as `해당 아님`, plain comparisons such as `~와 다르다`, code and quoted examples still pass. The lit-humanizer skill and its bundled rule teach the same habit.

- Editing a line that sits between two repeated pledges in a document no longer re-raises the pledge that was already there; adding another one is still refused.

- When OpenCode is started from a subfolder of the project, the write guard now resolves relative paths such as `../report.md` against that folder, so those deliverables are checked and internal folders such as `plans/` stay exempt.

- A flood of warnings can no longer push a refusal out of the guard's output: refusals are listed first and the list is capped.

## 1.0.28 - 2026-10-18

- The README gets you started sooner and says who LitOpenCode is for: people who give OpenCode work that spans more than one sitting, such as a feature over a few sessions, a planned refactor, research they come back to, or a report or deck built from their notes. A short evening-and-morning sketch shows a session picked up the next day, and the requirements now name OpenCode 1.18 or 1.19, because OpenCode 2 loads plugins differently and is not supported yet. The images are unchanged.

- Leftover notes about the retired skill-hint feature are gone from the release checklist and the privacy page.

## 1.0.27 - 2026-10-18

- When a startup update fails and the rollback leaves the old setup working, OpenCode no longer reruns the snapshot and npm install on every start. Startup leaves that same version alone for a day; an explicit install still runs it, and a newer release is tried at once. The receipt names the failed step, a timeout or a missing command, without command output. `litopencode doctor` now reports the update state, its cause, what the next start will run ("installed X, running Y") and a remedy for each cause, and says it cannot see inside a running OpenCode.

- The optional Jev skill hint is gone. In testing it improved skill choice by no more than run-to-run noise, and in real use the model followed none of the 45 hints it received. LitOpenCode no longer contacts TypeSafe, adds no hint line or toast, and `litopencode doctor` no longer reports it. `LITOPENCODE_JEV`, the other `LITOPENCODE_JEV_*` variables and `TYPESAFE_API_KEY` are now ignored and can be deleted, and so can an old debug trace at `.litopencode/logs/jev-skill-hint.jsonl`.

- lit-loop now loads the skill that matches a request before it inspects the workspace; plain questions and requests no listed skill covers still load none. The review-work trigger now names reviewing a patch, diff, PR or open changes, with Korean cues, and the workflow-loop trigger names carrying one feature, fix or ticket through build, tests, real-surface checks and cleanup.

- A request whose deliverable is a Markdown or plain-text file, such as `report.md` or `slides.md`, now gets ordinary Markdown. lit-docx and lit-pptx no longer write their converter source (YAML front matter and `:::` blocks) into those files or start a DOCX or PPTX build; they keep that source format only for files they render.

## 1.0.26 - 2026-10-16

- The write guard now refuses more of the lines that tell a reader what a document is not for, such as `This table is not a ranking.` or `이 문서는 제품을 비교하려는 것이 아닙니다.` These forms came from real sessions. Bold-label callouts such as `> **주의:** ...` are now read too, while ordinary quoted text is still skipped, and lines from manuals and lab reports that only look similar stay allowed. Files saved through `apply_patch` are now checked before they land, the same way the write and edit tools already were.

## 1.0.25 - 2026-10-15

- The write guard now refuses sentences that say what a document is not for, such as `동일 조건의 독립 성능 비교로 쓰지 않음.` or an English line saying a result is not a benchmark. When the model writes one with the write or edit tool, the call is refused and the model rewrites it. Three new rules cover Korean pledges, a Korean pledge repeated through a document, and the English forms, and the status-negation warning now also reads `쓰지 않음`, the polite endings and bold-wrapped endings. Legal and financial notices, safety warnings, operating rules, method lines and real negative findings stay untouched, and the rules still finish in milliseconds on very long runs of spaces. The lit-docx and lit-pptx skills now ask for a real limit once, as a fact beside the number it affects, and keep anything about what the document is not for in the reply.

## 1.0.24 - 2026-10-14

- The LIT card, the chip beside the prompt, the sidebar panel and the home line now wear the LIT colours in every OpenCode theme: the `🔥 LIT` pill runs from pink to flame, the workflow map ramps from flame through pink to the LIT accent, the running stage and the current skills are accent pills, and warnings and the finished state use LIT amber and green. Text, panels and borders still follow your theme, and on a light theme the LIT colours deepen so they stay readable. The README pictures of the card show the new look.

## 1.0.23 - 2026-10-13

- The README demo on GitHub is a new film of one real OpenCode turn with the workflow map. A numbered label names each part as it appears: the `lit` word, the LIT IGNITED toast, the card's map skipping interview and plan to light WORK, the new test, the running tool and its time beside the map (`bash · 0:00` while `npm test` runs), the passing test run and the card settling to IDLE when the turn ends. It still plays without music.

## 1.0.22 - 2026-10-13

- The LIT card, the chip beside the prompt and the sidebar now show where you are in the workflow, not only which skill ran. A map runs `interview › plan › work › review › done` and lights the step you are on with its count, such as `WORK 3/7` while `/start-work` works through a saved plan. A lit-loop goal counts its criteria instead (`CRITERION 1/3`), and a litresearch run follows its own steps from `decompose` through each `wave` to `synthesis`. A step the request went past without doing shows `–`. The sidebar draws the map top to bottom with a line that fills as you move forward.
- While a tool runs, its name and running time sit beside the map, like `⠹ bash · 0:48`. Only the tool's name and start time are read, never its command or arguments, and the step disappears when the turn ends.
- A finished mission can now tell you so. Add `{ "notify": true }` to the LitOpenCode entry in `tui.json` for a desktop notification and the `done` sound, or turn either one off with `{ "notify": { "sound": false } }` or `{ "notify": { "desktop": false } }`. It is off until you add it, and OpenCode plays nothing unless its own `"attention": { "enabled": true }` is set too.
- The README pictures of the status card are new captures from OpenCode showing the workflow map, the live tool step and the card after the turn, in English and Korean.
- A lit-loop turn shows its criteria even when the agent writes `goals.json` by hand, as one goal at the top or nested under `goal`, with `completed` or `done` counted as passed. A goal marked complete by hand passed no gate, so review stays at `–`; only a goal completed through the ledger, whose gate includes review, marks it done. In the criterion view the card leaves out the separate criteria count, so the live step keeps its room on the row.

## 1.0.21 - 2026-10-12

- The README demo on GitHub is a new film of one real OpenCode turn. It plays without music, and a numbered label names each part LitOpenCode adds as it appears: the `lit` word, the status card switching to WORK, the light mode for a small fix, the reply that reads before editing, the fix with its test, the real test run and the closing summary.
- The README now shows the LIT status card as it looks in OpenCode: quiet before the first lit prompt, bright skill chips while a request runs, and dimmed recent chips after the turn. It also walks through automatic handoff with pictures of the `lit-handoff auto` messages, the message and toast when the handoff runs, and the doctor block, in English and Korean.
- The quick start has a short prompt to paste into a coding agent so it installs LitOpenCode for you. The agent checks the requirements, shows a dry run and asks before installing, runs `litopencode doctor`, and reminds you to restart OpenCode.
- The LIT card along the bottom of the screen no longer stays on WORK after the agent has finished. When the session's turn ends it settles to `○ IDLE`, no step stays lit and the skill chips dim to the recent list; a subagent finishing does not change the main card, and your next prompt brings WORK back.
- Install now asks for a reasoning effort after each model, for the lead and the helpers, and lists every effort OpenCode offers for that model with the recommended one marked as the default. GPT-6 Astra and GPT-6.1 Sol offer low to max; GPT-6 Luna, GPT-6 Sol and the GPT-5.6 models offer none to max, so GPT-5.6 Luna can now use xhigh. OpenCode offers `ultra` for no model, so it is no longer offered either. A route you saved with `ultra` keeps working as `max`, `litopencode doctor` warns about it, and the next install changes it to `max` with a one-line notice after backing up `litopencode.json`.
- `litopencode doctor` now reads the automatic handoff setting from your project, the same place LitOpenCode itself uses, so a `lit-handoff auto on 70` sent in chat shows up in doctor. Run it from the project folder.
- lit-pptx now installs sharp 0.35.5, and the readme-studio motion templates use sharp 0.35.5 and source-map-js 1.2.2.

## 1.0.20 - 2026-10-12

- The band along the bottom of OpenCode's main screen is now a small card that stays on screen for the whole session. The top edge shows LIT, the current workflow and its phase. The first row shows PLAN ━ WORK ━ REVIEW with the goal and the next task. The second row shows a chip for each LitOpenCode skill that ran: skills used by the current request are bright and get a short shine as they appear, then dim into a recent list when the answer is done, and extra chips fold into `+N`. The bottom edge shows context use, elapsed time and the git branch. Before you use lit in a session, the card shows the project's last goal. `band: false` still hides it and `band: { card: true }` still adds the detail card.

## 1.0.19 - 2026-10-11

- The README is shorter for first-time readers. It says what LitOpenCode does, how to install it and what to type first, and the detail now lives in docs pages (guide, skills, screens and brand) in English and Korean. The GitHub page also plays a short film of a real session.
- A lit mission now shows in OpenCode's TUI. A pill chip sits by the prompt, a rounded sidebar panel carries the phase and a smooth progress bar, a band runs along the bottom of the main screen, the home screen shows a line for the last mission, and a finished mission gets a short completion moment. In the plugin's `tui.json` options, `band: false` turns the band off and `band: { card: true }` adds a card under it with the warnings, the next task and the goal.
- Install adds the TUI plugin to `tui.json` or `tui.jsonc` and backs the file up first, and `litopencode tui remove` takes it out again. Auto-update backs up these files with the rest of the install and puts them back when an update fails.
- Install and doctor read a commented `opencode.jsonc` safely. They accept comments, trailing commas, a BOM and CRLF line endings, and an edit keeps every comment. When a comment sits inside an entry that has to change, install stops before writing anything and prints the entry to add by hand. A second install from a local checkout no longer adds a duplicate plugin entry.
- A prompt such as "lit turn notes.md into a 10-slide deck" now loads the office skills: lit-pptx for a deck and lit-docx for a Word report. The dot in a file name no longer breaks the match.
- The prose check that runs before a write now skips YAML, JSON and CSV files, so a line such as `source:` in a config file no longer blocks the write.
- `--dry-run` writes nothing. Loop commands that change the ledger list the files they would touch, and `motion-runtime` refuses an unknown option before it downloads anything.

## 1.0.18 - 2026-10-09

- The prose check that runs before a file is written now works inside OpenCode. It used to start under OpenCode's own program instead of Node and to look for the new text in the wrong place, so it never saw a write. It now stops an added line such as an unrequested source label before the file is saved, adds a short note after the write when the wording only needs a second look, and checks the text of the Word, PowerPoint and PDF files a session creates.
- The eight deck looks and six document looks no longer list settings the engines never applied, such as tabular figures, chart annotation, picture bleed and crop, and page-fill targets, and their reference pages no longer promise them. Decks and documents come out exactly as before.
- The deck check treats a one-word placeholder term such as "todo", "tbd", "fixme" or "placeholder" as a word. A word like "Mastodon" no longer fails a deck, while "TODO:", "TODOs" and "(TBD)" still do.

## 1.0.17 - 2026-10-08

- `lit-pptx` now decides how a deck should look before it builds anything. It reads what the deck is for and who will see it, then picks one of eight looks: one for dense reviews that are read closely, one for pitches, one for decks led by pictures, one for teaching, one for research talks, one for Korean briefing pages, one for editorial portfolios and one for data talks on a dark screen. The reply names the look, says why it fits and offers two alternatives. A bare request gets no style questions.
- `lit-docx` does the same for documents with six looks: Report, Brief, Manual, Proposal, Memo and Journal. Each is built its own way, from what stands on the first page to how sections are numbered, and all six share one quiet page with near-black headings and thin-ruled tables. The reply names the look, the reason and two alternatives. Journal manuscripts keep their publisher profiles.
- New checks read every slide and every page and fail the build until the layout is fixed. They catch an empty area beside a full one, a column much shorter than the one next to it, a heading left alone at the foot of a column or page, a short list split across pages, and a last page whose columns end at different depths. The page checks for documents need LibreOffice to render the pages.
- Decks now ship the official Pretendard Regular and Bold files, unchanged; earlier releases carried a renamed subset. Word documents are set in Pretendard too, so install it on the computer that opens them to see the intended look.

## 1.0.16 - 2026-10-01

- Automatic handoff now finds the handoff it asked for after compaction even when the model formats the marker line, for example as a bullet, in backticks or in bold. A handoff written by another session is still ignored.

## 1.0.15 - 2026-09-30

- `gpt-6.1-sol` is now the recommended coding-lead alternative, because OpenAI lists `gpt-6-sol` as the previous generation. The installer model menu offers it as the coding lead and keeps `gpt-6-sol` listed as the previous generation, and the reference describes both. Routes that already use `gpt-6-sol` keep working, and `litopencode doctor` still accepts them.

## 1.0.14 - 2026-09-30

- Add an optional automatic handoff. It is off until you turn it on, and you choose the context percent; LitOpenCode has no default percent. When the conversation reaches your percent and the turn ends, LitOpenCode asks the model to write a handoff, checks that the file was saved, compacts the conversation, and puts the start of the handoff back in front of the model once. On OpenCode every one of those steps runs by itself. If OpenCode cannot start the compaction, a toast says "Handoff saved. Run /compact now."
- Turn automatic handoff on with `lit-handoff auto on 70` (use your own number), or with `LITOPENCODE_AUTO_HANDOFF=1` and `LITOPENCODE_AUTO_HANDOFF_PERCENT`. `lit-handoff auto status` shows where it stands, and `litopencode doctor` warns when your percent is at or above the point where OpenCode compacts on its own.
- The README no longer shows the A/B comparison; one run per side was too little to support its verdicts. The same section is gone from the npm page.
- The GitHub pages (English and Korean) now show terminal pictures of what LitOpenCode prints, and the motion film was remade in Pretendard with a Korean version.

## 1.0.13 - 2026-09-30

- The GitHub pages (English and Korean) now show what Jev looks like: the `litopencode doctor` line and the toasts when Jev is off, on, or missing its key. Jev stays off unless you turn it on, and the reference lists what each toast says.
- The GitHub pages gained a short motion film that follows one `lit` prompt from request to record.
- The package no longer carries the Jev pictures and the film, which only the GitHub pages show, so the download is about 1.8 MB smaller.

## 1.0.12 - 2026-09-29

- The npm page is a short install card that links to the full guide on GitHub.
- The English and Korean READMEs and the npm card were rewritten in plainer language, with the reason given before each switch.

## 1.0.11 - 2026-09-29

- The motion skill's runtime now installs `ws` 8.22.0 instead of 8.18.3, which fixes a memory-exhaustion denial of service and an uninitialized-memory disclosure in that package. After upgrading, run `litopencode motion-runtime install` again so the cache picks up the new version.
- Two Wikify captures running at the same moment no longer fail with a blocked store error when one of them releases its lock while the other is checking it. The waiting capture now retries.
- A Lit slash command now shows the `🔥 LIT IGNITED` toast once. Before, the same toast appeared twice, with the second one replacing the first.
- The Jev debug trace (`LITOPENCODE_JEV_TRACE=1`) now also refuses a symlinked `.litopencode` or `.litopencode/logs` folder. It writes nothing and the turn continues normally.

## 1.0.10 - 2026-09-28

- Add an optional Jev skill hint. It is off by default. With `LITOPENCODE_JEV=1` and your own `TYPESAFE_API_KEY` set, an eligible chat turn gets one advisory line naming a LitOpenCode skill. The model still decides whether to load it.
- When the hint is on, each eligible prompt is sent to TypeSafe. Home paths, e-mail addresses, `password=`-style assignments and other token-shaped strings are replaced first, and the prompt is then cut to 2,000 characters. Files, tool output and earlier turns are not sent. Slash commands and child sessions are skipped.
- While the hint is on, a `✦ Jev skill hint is ON` toast shows once per session, and a turn that gets a hint shows a short toast such as `Jev → lit-humanizer (0.27s)`. `litopencode doctor` reports whether the hint is off, on, or missing its key.
- The hint reaches the model but is not shown or copied as your own words. A redirected Jev request is refused, and the debug trace never writes through a symlink.
- A skill started with a slash command now stays active in a running OpenCode. Before, it was cleared when the command's message arrived.

## 1.0.9 - 2026-09-28

- The repository no longer carries maintainer-only release tooling, and the package no longer ships it.

## 1.0.8 - 2026-09-28

- Add `lit-humanizer`, which replaces `lit-korean`. It brings an always-on writing rule, a packaged detector, and a pre-write guard for new reader-facing text. `/lit-korean` and the other former Korean prose routes keep working as aliases.
- Add `lit-pptx` for editable PowerPoint decks built from a Markdown slide source, and `lit-docx` for styled Word reports and manuscripts. A bare `lit` request for slides or a report loads the matching skill. Decks are checked against measured slide rules, and reports get a line-length and number-alignment audit.
- Add `lit-diagram-drawer` with 61 type guides, 183 templates, local verification, bounded diagram import, and export checks that need no installs. A bounded diagram request with `lit` loads it before drawing; ordinary work, UI requests, quoted text, and planning are unchanged.
- Give `frontend-ui-ux` build, polish, audit, and harden modes, a craft floor, a list of common interface faults, and a measured interface probe that checks the finished page in a browser. Motion guidance is now part of its routed references.
- Add `lit-typographic-motion`, which directs a film from a written treatment. Films that show things render a stage page frame by frame; films made of words take the type path. Each film gets a generated sound bed and is not done until its look rounds are recorded on the final frames.
- `browser-drive` accepts `agent-browser` 0.34.0 and newer, and shows the manual setup and a first-run check when the driver is missing.
- Replace the two README covers with one looping motion cover: the five robots power on in turn and the LitOpenCode robot wakes. The reduced-motion still shows the fully lit frame.
- Show the README A/B results as final verdicts for ten tasks with pictures of both sides, and add a skill table with a snapshot, routes, and a one-line summary for each user-facing skill, in English and Korean.
- A plain `lit` request for a self-contained task now works on it directly, without a durable plan, goal ledger, or delegation. `lit loop` or a request for long, multi-turn work still starts the full loop.
- `lit` prompts sent through `opencode run` now activate the same way as typed ones.
- `litresearch` version comparisons pair each dimension across the named versions and state a concrete migration effect.

## 1.0.7

- Run the automatic update's staged installer on Node instead of the OpenCode host binary, so a new release no longer rolls back and leaves the plugin unloaded.
- Keep `~/.litopencode/` owner-only instead of refusing a directory created world-readable by earlier state writers, and load the current install when the state directory is unusable.

## 1.0.6

- Ask about competing visual directions the brief leaves open instead of silently applying an announced default.
- Show the link target, its resolved directory, and any same-named shadowing skill for the shared native skills root in install and doctor output.
- Show the robot cover as a visible image under the motion hero in both READMEs instead of behind a hidden link, and remove the duplicate copy that repeated near the LITFAMILY illustration.

## 1.0.5

- Add README Studio decoration patterns and the bounded multi-round design interview.
- Default fresh OpenAI-provider installs to GPT-6 Astra for planning and review and GPT-6 Luna for execution and research, with GPT-6 Sol available as a coding-lead option.
- Align the bilingual READMEs with the family layout and pin npm-rendered package links and images to this release.

## 1.0.4

- Remove the repeated discipline label from completion marks so the model's bold ignition line appears once.

## 1.0.3

- Replace the activation probe with a bold LIT ignition line; show a color-free six-second warning toast with the micro mark and discipline label when mark glyphs are supported, and use the label alone otherwise.

## 1.0.2

- Add an animated README cover with a static image for reduced-motion settings.
- Remove automatic skill review because it never completed a review in practice. Existing `.lit*/pending-review.json` and `skill-loop-state.json` files are inert and may be deleted; no other state is affected.
- Make `npm publish` refuse to proceed when the test suite fails.
- Remove private checkout paths from the `lit-plan` example and two contract examples.

## 1.0.1

- Remove the runtime host-plugin dependency chain from consumer installs. LitOpenCode now ships
  its own `zod@4.1.8` tool schema helper, so Node 22.22.0 installs no longer warn or fail strict
  engine checks on transitive `effect`/`ini` packages while OpenCode tool registration remains intact.

## 1.0.0

- Prepare `@litfamily/litopencode` for independent OpenCode installation. The executable,
  native plugin ID, configuration paths, and ownership markers remain `litopencode`.
- Migrate published-package and prior package registrations while preserving tuple
  options, authored routes, and user-owned files. Update checks validate the exact scoped
  package identity before suggesting or staging a newer stable version.
- Keep planning agents read-only, permission changes explicit, and workflow evidence local.
  Ship the reader-facing communication contract and canonical skill routes with compatibility aliases.
- Align bilingual installation, safety, removal, community, and privacy guidance with the
  scoped package. Apply the Ignition vector cover and keep installation commands as editable
  README text. Align the terminal mark with the approved interlocking Ignition symbol
  and its orange, lime, and ivory palette.
- Preserve unattended installer behavior and terminal fallbacks. Covers and maintainer-only
  materials remain outside the npm payload; native runtime and managed skill resources stay packaged.

## 0.2.7 - 2026-09-03

- Add one advisory reader-facing communication contract to the effective OpenCode system,
  activation, and agent prompts so routine operational metadata stays out of default replies while
  material failures, risks, and required actions remain visible.
- Keep `reader`, `technical`, and `audit` request-scoped, and require parent agents to filter child
  reports without reducing internal DoneClaims, verification, evidence, ledgers, or handoff detail.
- Add regression and package-parity coverage for prompt injection, compaction, delegation, handoff,
  structured output, and explicit-detail overrides.
- Make JSON version lockstep count only the package identity fields, so dependency metadata that
  happens to match the release version cannot block a valid bump.

## 0.2.6 - 2026-09-02

- Move vendored handoff and scientific-visualization corpora to `vendor/` with
  thin skill wrappers remaining in the skill paths.
- Count vendor license, provenance, and NOTICE companions in family
  payload-parity so packed skills keep the material they name.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.5 - 2026-09-02

- Hardened inode-reuse checks across skill-loop roots, runtime and anchored-worker file operations,
  knowledge state, observer logs/locks, and Autoresearch/Autoconference publication. Stable stat
  identity now carries device/inode plus ctime and birthtime (directory checks use birthtime), with
  regular-file link-count checks at descriptor and cleanup boundaries.
- Bound trusted review launchers and shebang interpreters to SHA-256 bytes read through `O_NOFOLLOW`
  descriptors and verified before and after use; failed observer lock creation now retires and
  rechecks the lock before removal, and only cooperative parent races are retried.
- Added eight inode-reuse simulations covering launcher, directory/file, anchored worker, knowledge,
  lock, observer cleanup, and publication paths; regenerated managed-skill hashes.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.4 - 2026-09-01

- Added the stacked LitFamily ASCII wordmark to the LitOpenCode CLI and both English and Korean
  README landing pages; the wordmark remains version-free.
- Made interactive terminal installs show the model route picker by default, with the current
  managed lead and helper routes pre-selected. `--yes`, `--no-model-prompt`, dry-run, and
  non-interactive paths retain their existing behavior.
- Extended version lockstep coverage to every registered version-bearing file, counting both
  literal and escaped-regex spellings, and added repository registry tests.
- Wired the credential-free behavior-replacement, installed-resource-tamper, negative-gate,
  rules-glob-differential, and Wikify surface QA layers into CI with named exclusions for the
  composite probe to avoid duplicate work.
- Kept local OpenCode runtime state out of tracked files. This is a local release candidate only;
  no publish, tag, or push was performed.

## 0.2.3 - 2026-08-31

- Added packed-payload substance, cross-product parity, and referenced-path checks
  so installed OpenCode skills retain the material they name.
- Refreshed the canonical legal attribution metadata without changing the four
  upstream attributions it records. This is a local release candidate only; no
  publish, tag, or push was performed.

## 0.2.2 - 2026-08-30

- Added installer model/provider choice with separate lead and helper routes,
  including `-fast` model-id normalisation so the lead upgrade applies to
  `lit-loop`, `momus`, and `litwork-reviewer` defaults.
- Routed the review child through the configured provider credential descriptor,
  added a symlink-safe host auth-store read, and retained bounded proposal-only
  review behavior.
- Kept the plan-file gate and Windows fail-closed learning-loop boundary visible
  in the OpenCode docs and runtime surfaces.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.2.1 - 2026-08-29

- Added the OpenCode-native skill learning loop: user-invoked review or validated proposal import
  creates pending records, and only an explicit foreground `skill-loop apply` can write an
  agent-marked skill under the OpenCode user skill root. Shipped, installer-managed, unmarked,
  symlinked, secret-bearing, and non-portable targets fail closed.
- Added strict proposal and decision-ledger readers, content-addressed apply/rollback receipts, a
  usage sidecar, deterministic user-invoked curator transitions, and bounded `tool.execute.after`
  counter/noticing without hook-triggered model calls or automatic application.
- Enrolled the expanded Skill Observer and its byte-pinned review contract in the managed install
  and package surfaces. Prepared package, lockfile, README, release-checklist, and release-fixture
  version surfaces at `0.2.1`; this entry does not imply publication, tagging, or a remote release.
- Hardened review-host pinning, bounded current-skill context, transaction recovery, and root-anchored
  mutations. Review, user-skill mutation, rollback, and curator operations now fail closed on Windows
  with `WINDOWS_SKILL_LOOP_UNSUPPORTED` until native handle and ACL support is available; passive and
  project-local proposal surfaces remain available.

## 0.2.0 - 2026-08-27

- Added a standalone output-channel declaration across the 41-skill corpus, with the two
  activation-byte-budgeted UI/UX contracts declaring from their reachable
  `references/complete-contract.md` files. A structural documentation gate now rejects missing
  declarations, unknown artifact genres, and genre/channel mismatches.
- Added a deliverable hedge guard to OpenCode's `tool.execute.after` surface. That event can inspect
  bounded text carried by native `write` and `edit` inputs, so the guard appends a
  model-visible, genre-aware advisory without reopening an artifact path or replacing the successful
  tool result. Unknown, path-only, and oversized input shapes fail open. The guard reads the active
  skill's declaration rather than hardcoding an artifact genre.
- Kept the behavioral claim narrow: two isolated A/B runs found no measurable improvement from the
  contract prose alone. The declaration is machine-readable metadata consumed by the guard; this
  release claims that the guard flags qualifying hedges, not that the prose makes the model write a
  cleaner document.
- Bumped to `0.2.0` because the corpus-wide contract and new runtime hook are a new product surface,
  rather than another maintenance increment within the `0.1.x` line.

## 0.1.70 - 2026-08-26

- Aligned the package, lockfile, README surfaces, release checklist, and
  release fixtures at `0.1.70` for G20 slice 19.

## 0.1.69 - 2026-08-23

- Added the `frontend-ui-ux` taste dials, `browser-drive`, and `skill-observer`
  workflow surfaces with managed package coverage.
- Kept package, lockfile, README surfaces, and release-fixture versions aligned at `0.1.69`.

## 0.1.68 - 2026-08-15

- Simplified the English and Korean README surfaces and pinned the packaged
  cover link to the exact release version.
- Kept package, lockfile, and release-fixture versions aligned at `0.1.68`.

## 0.1.67 - 2026-08-14

- Added provider-free activation and cache measurement contracts with packed
  consumer coverage and deterministic lock-race handling.

## 0.1.66 - 2026-08-12

- Added advisory evidence review guidance to the `frontend-ui-ux` skill.
- Added managed-skill manifest and documentation coverage for the guidance.

## 0.1.65 - 2026-08-11

- Added project-local Wikify knowledge capture, review, save, query, and status flows. Structured
  events remain `review-needed` until an explicit review changes their state. Queries return only
  accepted records with bounded deterministic output, provenance, and `claims.jsonl` as the sole authority.
- Hardened the knowledge store against lock and publication races. Concurrent duplicate writers converge
  on one record. Lock-owner disappearance, authority replacement, staged writes, atomic renames, and
  recovery boundaries fail closed without false success results.

## 0.1.64 - 2026-08-09

- Added a default-on foreground update barrier at plugin startup for eligible
  interactive lifecycle paths. It pins an exact stable package, uses a
  credential-free npm environment and transaction lock, verifies with doctor,
  and records rollback/unknown-state receipts before exposing hooks.
- Kept the detached notifier cache-only and added explicit opt-outs for users
  who want advisory checks without automatic installation.

## 0.1.63 - 2026-08-06

- Added `outputStyle` config field (`off | asd-ste100 | asd-ste100-ko | eli5 | eli5-ko`) that injects
  a style instruction into the system prompt after repository rules. The install prompt offers a
  five-choice menu (default: keep current / off). Validated in the config parser; fails open with no
  push when the file is missing or the style is `off`.

## 0.1.62 - 2026-08-05

- Re-routed the shipped agent default from `gpt-5.6-sol`/`high` (with `gpt-5.6-terra`/`xhigh` for
  `lit-explorer` and `lit-librarian`) to `gpt-5.6-luna`/`max` for every shipped agent, following
  price/performance data showing Luna at max effort matches Sol at high effort on pass rate at
  roughly a quarter of the cost. The interactive picker now offers only LUNA, and the effort floor
  moved with it: below-high Luna effort is rejected the same way below-high TERRA effort was
  before.

## 0.1.61 - 2026-08-04

- Added one exact chat-safe checklist grammar for `lit-plan`: consecutive column-zero rows under
  `## TODOs` carry concrete Action, Output, and Verification fields, and rows under
  `## Final verification` carry concrete Verification fields. The planning agent, `/lit-plan`
  command hook, installed skill, and optional scaffolder expose that shape, while `/start-work`
  remains separately routed to `lit-implement` and `lit-plan` retains its edit, bash, task, and write
  denials.
- Made the optional file-backed checker require active concrete rows, reject placeholder, blank,
  malformed-marker, misnumbered, and completed-only handoffs, including exact case-insensitive
  `TBD`/`TODO` and ellipsis-only fields, and exclude fenced, nested, indented, and incidental decoys.
  `managed-skill-manifest.json` coverage and the focused regression were updated with the contract.

## 0.1.60 - 2026-08-02

- Fixed the `frontend-ui-ux` CLI entrypoint guard, which compared an unresolved `process.argv[1]`
  against `import.meta.url`. Reached through a symlink — which is how an installed skills root
  reaches it — the CLI never ran: an invalid design contract and an unknown subcommand both exited 0
  with empty output, voiding the 0/1/2 contract the file's own header declares. Both sides are now
  resolved with `realpathSync`.
- Gave the `frontend-ui-ux` JSON trust layer machine-readable error codes. `strict-json`,
  `bounded-json`, `stdin-json`, and `uiux` threw bare `Error`/`TypeError`, so a caller could not tell
  a malformed payload from an unusable file from a bad argument without matching on prose. They now
  raise a `ContractError` carrying `JSON_INVALID`, `FILE_INVALID`, or `ARGUMENT_INVALID`, with
  `DESIGN_CONTRACT_INVALID` available to callers. Exit codes are unchanged.
- Added a language server catalog to `lsp-setup`. The skill's method asks which extension is
  unserved but shipped nothing that could answer it. `references/` now maps 20 languages to their
  server, install cost, alternatives, the failure modes that produce confidently wrong diagnostics,
  and the fallback to use while a file stays unserved.
- Added runtime, escalation, and tool references to `debugging`: how to obtain a real observation in
  Node, Python, Go, Rust, a compiled binary without source, and a bundled JS executable; the
  two-dead-rounds reframe; and the specialist tools for symptoms ordinary instrumentation cannot see.
- Added per-language references to `programming` for Go, Python, Rust, and TypeScript, covering type
  patterns, failure handling, concurrency, testing, and strict tooling configuration. These are
  defaults for new code — the surrounding project's conventions still win.

## 0.1.59 - 2026-08-02

- Added the `lit-comprehend` runtime skill and `/lit-comprehend` command for when understanding,
  not status, is the bottleneck: after a long agent session it builds one self-contained explainer
  artifact a person can reason with, rather than the chronology `lit-recap` already provides. It
  anchors on what the reader already knew, orders the walkthrough conceptually instead of by file,
  ships an interactive micro-world, discloses what is not verified, and closes with a quiz framed
  as a speed regulator.
- Gated execution rather than narrowing activation: being invoked is not permission to build. An
  invocation naming a path or git range proceeds; a bare invocation or a prose question gets a
  one-screen scope proposal (target, exclusions, estimate) and waits for approval, with the
  cheaper one-sentence answer offered when the request deserves it. The proposal is derived from
  `git status`, `git diff --stat`, and durable state, never by reading the tree.
- Bundled `scripts/verify-explainer.ts`, an HTML scaffold, and authoring references. The verifier
  fails an artifact for a phantom code quote, a quote attributed to a missing file, code quoted
  with no attribution, an external resource reference, a missing canonical section, an artifact
  written inside the worktree, a quiz option without feedback, a positional tell, collapsed code
  blocks, and ASCII-art diagrams.
- Routing accepts `lit-comprehend`, bare `comprehend`, and `lit comprehend`; `comprehension`,
  `incomprehensible`, `설명해줘`, `이해가 안 돼요`, and `explain this function to me` are proven
  by negative-control tests not to activate.

## 0.1.58 - 2026-07-30

- Fixed `lit`/`litwork`/`start-work`/`review-work` status reads crashing with a ledger parse error
  when the workspace's append-only ledger contains legacy events (for example an `event` key
  instead of `type`). Status now uses a lenient read that skips invalid lines and reports a bounded
  diagnostic; strict parsing is unchanged for writes, recovery, and the bounded-authority lifecycle.
- Moved the CI dry-pack report outside the package root so the guard never scans its own report,
  and rejected non-finite `run_with_deadline.py` seconds as typed CLI input errors.

## 0.1.57 - 2026-07-29

- Added the exact verified 167-file canonical frontend reference library as an inert, separately
  managed corpus while preserving the existing normalized retrieval dataset.
- Added one managed Autoresearch family with ten nested modes, one managed Autoconference family with
  seven nested modes and fail-closed task capability, and one managed Wikify family with five nested
  modes and five templates.
- Added hyphen-native family command aliases and bounded leading chat activation without adding tools,
  agents, MCP servers, daemons, publication actions, or live-profile mutation.
- Replaced cumulative README release chronology with current supported behavior and replayable gates.

For earlier versions, use the repository tags and commit history together with the release checklist;
those are authoritative for the exact source and verification state of each release.
