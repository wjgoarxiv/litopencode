<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitOpenCode

**LitOpenCode is a workflow plugin for OpenCode. Add `lit` to a prompt and the work gets planned, built, checked and written down, so the next session knows where you stopped.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.20" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
<a href="./docs/guide.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp; <a href="./docs/screens.md"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Screens</a> &nbsp; <a href="./docs/skills.md">Skills</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a> &nbsp; <a href="./README-Ko-KR.md">한국어</a>
</p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="A title card with the LIT mark reads LitOpenCode, The lit workflow for OpenCode. Then OpenCode opens in a small project, ~/greet, and a numbered label names each step as it happens. 1, Start with “lit”: the prompt &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot; is typed into OpenCode. 2, LitOpenCode lights up: a toast with the LIT mark reads &quot;🔥 LIT IGNITED · lit-task 🔥&quot; and the LIT status card at the bottom switches to WORK with a lit-task skill chip. 3, It sizes the job: lit-task keeps the small fix light and writes no plan files. 4, It reads before editing: the reply opens with the LIT mark and reads package.json, greet.js and test/greet.test.js. 5, The fix, with a test: greet.js changes and test/greet.test.js gains a test for shouting. 6, The agent runs npm test, which passes, and node greet.js --shout Ada, which prints HELLO, ADA!. 7, Done, with evidence: the summary says Implemented --shout and npm test passes: 2 tests. The film ends on the LitOpenCode mark and the install command." /></p> <!-- demo-gif -->

## Why you might want it

OpenCode is good at the conversation in front of it. The trouble starts when that conversation ends. A long session gets compacted, you close the terminal, and the next morning you are piecing together what you decided, what you already checked, and what was left. OpenCode has no place of its own to keep a goal between sessions.

LitOpenCode gives the work a routine and a memory. Add `lit` to a prompt and the task goes through the same steps each time: frame it, plan it, build it, check it, and write down the next step. Those notes go into `.litopencode/litgoal/` inside your project, so the next session reads them and carries on from there. Bigger jobs can be planned first by an agent that is not allowed to touch your files, then carried out and reviewed.

You keep using OpenCode the way you do now. It still runs the model and asks for permission the way it always has, and your provider login stays where it is. LitOpenCode needs no other LitFamily product.

## Quick start

You need Node.js with npm, and [OpenCode](https://opencode.ai) with a model provider already set up. Install with one command:

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

The installer asks which models to use and how much freedom the agents get; add `--yes` to take the defaults, or `--dry-run` to see what would change without writing anything. Permissions start at `safe`, where OpenCode asks you before acting.

**Or let a coding agent install it.** Paste this into the agent you already use. It checks first, shows you the plan and waits for your yes before anything changes.

```text
Please install LitOpenCode, the lit workflow plugin for OpenCode, on this machine.
1. Check that Node.js, npm and OpenCode are installed (node --version, npm --version, opencode --version). If one is missing, stop and tell me.
2. Use only the official npm package @litfamily/litopencode. No forks, mirrors, curl scripts or other packages.
3. Before changing anything, run: npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run
   Show me what it would change and ask me whether to go ahead with the defaults.
4. When I say yes, run: npm exec --package @litfamily/litopencode@latest -- litopencode install --yes
   Do not edit OpenCode's config files by hand.
5. Run: npm exec --package @litfamily/litopencode@latest -- litopencode doctor
   Tell me whether install.ok, install.plugin.ok and install.nativeSkills.ok are true, and quote any warning.
6. Remind me to restart OpenCode, press Tab and choose lit-loop.
```

Restart OpenCode, press **Tab**, and pick **lit-loop**. Then open an empty folder and send your first task:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

**What you will see.** For six seconds a toast appears that reads `🔥 LIT IGNITED` with the name of the workflow that started, which tells you LitOpenCode picked up your prompt. When the work is done you have an `index.html` to open and try, and a record of what was built and checked in `.litopencode/litgoal/`. Come back another day, type `/lit-recap`, and it tells you what was done and what comes next. [Screens](./docs/screens.md) shows the installer, the toast, the health check and the planner's locked permissions, so a healthy install looks familiar.

The model inside OpenCode does the work, and a model can be wrong. When a reply says something passed, open the file and look for yourself.

## What you get

**Start with one word.** Put `lit` at the end of any request, or type `/lit`. The task is framed, planned, built, verified and recapped, and each step leaves a note you can read later.

```text
Add a dark-mode toggle to the settings page and keep the existing tests passing lit
```

**Plan first when the job is big.** Press Tab and pick `lit-plan`. The planner reads your project and writes a checklist, then waits for explicit user confirmation; it cannot edit files, run shell commands or hand work to another agent. Run `/start-work` to carry the approved plan out one slice at a time, and `/review-work` to have the change looked at from five angles, worst findings first.

**Pick up where you stopped.** Type a bare `handoff`, or `/lit-handoff`, to leave a continuation file for the next session, and `/lit-recap` to read back what is done, what is blocked and what is next. If you like, [automatic handoff](#automatic-handoff) writes the handoff for you before the context window fills up.

**Research with sources.** `/litresearch` works in rounds and keeps a source next to each claim, along with what is still uncertain.

```text
lit research Which SQLite settings matter most for a write-heavy local app?
```

**Reports, decks and figures.** Ask for a report or slides with `lit` and you get an editable Word file or PowerPoint deck, built from a Markdown source you keep, in a design direction the skill picks and names first. Journal-sized figures from measured data come from `/lit-scientific-visualization`, and concept diagrams have a skill of their own.

```text
lit Turn notes.md into a ten-slide deck for Friday's team review
```

**Writing that sounds like a person.** `/lit-humanizer` rewrites stiff English or Korean prose while keeping the facts, the writer's voice and the qualifiers that matter.

There is more: debugging, refactoring, code cleanup, commits, language servers, repository rules that load once per session and again for files you edit (`/rules`), interface work, browser automation and a project wiki. The [skills gallery](./docs/skills.md) shows each one with a picture of what it makes.

## The LIT card

With LitOpenCode installed, every OpenCode session gets a small card along the bottom of the screen. It stays there for the whole session and keeps the same four rows whether anything is running or not, so your prompt never jumps.

Before your first `lit` prompt the card is quiet. The title reads `🔥 LIT · ready` with `○ IDLE` beside it, the phase track is dim, and the card tells you how to start. Its bottom edge shows how full the context window is and which git branch you are on.

<p align="center"><img src="./docs/assets/readme/status-card-idle.webp" width="760" alt="The LIT status card in OpenCode before any lit prompt. The top border reads 🔥 LIT · ready on the left and ○ IDLE on the right. The first row shows a dim PLAN ━ WORK ━ REVIEW track and add lit to a prompt to start, the second row reads skills none yet, and the bottom border shows ctx 4% · ⎇ main." /></p>

Send a prompt with `lit` and the card wakes up. The title names the workflow and its phase, the track shows which step is running, and each LitOpenCode skill the request uses gets a bright chip of its own, with a short sweep of light as it arrives. In this request two skills are at work at once, while `debugging`, used in an earlier turn, waits in grey.

<p align="center"><img src="./docs/assets/readme/status-card-working.webp" width="760" alt="The LIT status card while a lit request runs. The top border reads 🔥 LIT · lit-humanizer with ● WORK on the right, and the track highlights WORK. The skills row shows two bright purple chips, lit-humanizer and lit-diagram-drawer, then a grey debugging chip. The bottom border reads ctx 6% · ⟳ 0m · ⎇ main." /></p>

When the turn ends the card settles: the title switches to `○ IDLE`, no step stays lit, and the chips dim but stay, newest first, so you can still see what ran. Your next prompt wakes it again. A skill used again lights up again, and when there are more chips than room, the rest fold into `+N`.

<p align="center"><img src="./docs/assets/readme/status-card-recent.webp" width="760" alt="The LIT status card after the turn ends. The title reads 🔥 LIT · lit-humanizer with ○ IDLE, and no step on the track is lit. All three chips are grey now and listed newest first: lit-diagram-drawer, lit-humanizer, debugging. The bottom border reads ctx 7% · ⟳ 0m · ⎇ main." /></p>

The card is on by default. To keep the bottom of the screen clear, give the LitOpenCode entry in OpenCode's `tui.json` the option `{ "band": false }`. When you want more detail, `{ "band": { "card": true } }` adds a second card underneath with the goal, the next task and any warnings. The [reference](./docs/reference.md#tui-mission-panel) explains every part of the card.

## Automatic handoff

A long conversation eventually fills the model's context window, and whatever falls out of it is forgotten. Automatic handoff saves your place before that happens. It stays off until you turn it on, and the percent is yours to choose.

To turn it on, send `lit-handoff auto on 70` as a message on its own, with your own number in place of 70; `/lit-handoff auto on 70` does the same. LitOpenCode answers with the new setting, and the model passes it on in a sentence or two. `lit-handoff auto status` tells you where things stand and where the setting came from. `lit-handoff auto off` turns it off and keeps your number, so a later `lit-handoff auto on` without a number picks it up again.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-settings-dark.webp" /><img src="./docs/assets/readme/auto-handoff-settings-light.webp" width="760" alt="Three chat messages in OpenCode, each followed by LitOpenCode's answer. lit-handoff auto on 70: Auto-handoff is ON at 70%. When a conversation reaches 70% of the model's context window, LitOpenCode asks the model to save a handoff, compacts the conversation, and loads the handoff back. lit-handoff auto status: the same lines, then The switch comes from the saved setting and the percent from the saved setting, and a pointer to litopencode doctor. lit-handoff auto off: Auto-handoff is OFF. The last percent, 70%, is kept for the next time you switch it on." /></picture></p>

From then on LitOpenCode keeps an eye on how full the context window is. Once the conversation reaches your percent and the current turn ends, it sends the model a short message asking for a handoff. The saved file has to carry the marker line from that message, so a handoff left over from earlier never counts. When the new one checks out, the plugin compacts the conversation itself, says so in a toast, and puts the start of the handoff in front of the model on the next turn. You never have to type `/compact`.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-compact-dark.webp" /><img src="./docs/assets/readme/auto-handoff-compact-light.webp" width="760" alt="The message LitOpenCode sends once the conversation reaches 70%: Automatic handoff: this conversation has reached about 70% of the context window. Write the handoff now. It asks for the line Auto-handoff marker: ses_2b9f1c7a4e 2026-10-12T17:05:00.000Z under the handoff's title and a one-sentence reply that names the file. Below it, a toast titled LitOpenCode auto-handoff reads Handoff saved. Compacting the conversation now." /></picture></p>

If no handoff was saved, the conversation stays as it is and a toast tells you. If OpenCode refuses to compact, a toast asks you to run `/compact` yourself.

Pick a percent below the point where OpenCode compacts on its own, because the handoff needs room to run first. With the limits LitOpenCode installs, OpenCode compacts at 90%, and `litopencode doctor` warns you when your percent is at or above that. Run it from your project and doctor also shows the setting and where it came from, whether you saved it in chat, in a config file or in the environment that starts OpenCode. In the environment, `LITOPENCODE_AUTO_HANDOFF=1` switches it on, `LITOPENCODE_AUTO_HANDOFF_PERCENT` takes a whole number from 1 to 99, and the environment wins over the chat setting.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-doctor-dark.webp" /><img src="./docs/assets/readme/auto-handoff-doctor-light.webp" width="694" alt="Terminal window showing LITOPENCODE_AUTO_HANDOFF=1 LITOPENCODE_AUTO_HANDOFF_PERCENT=70 litopencode doctor piped to jq, which keeps part of the autoHandoff block: enabled true, percent 70, sources with enabled env and percent env, host with autoCompaction true and compactionPercent 90, and an empty warnings list." /></picture></p>

To keep the setting in a file, add an `autoHandoff` block to `.litopencode/config.json` in your project, or to `~/.config/opencode/litopencode.json` for every project. The environment and the chat setting both come before the file.

```json
{ "autoHandoff": { "enabled": true, "percent": 70 } }
```

The [guide](./docs/guide.md#automatic-handoff) walks through each step, and the [reference](./docs/reference.md#automatic-handoff) lists every setting and what is written to disk.

## How it works

OpenCode loads LitOpenCode as a plugin from its config file. When you send a prompt or a command, the plugin picks the workflow that fits and points the model at the skills it needs. Its tools and hooks write down what happened in your project, and `/lit-recap` or the next session reads that record back.

```mermaid
flowchart LR
    Prompt["Your prompt with lit"] --> Plugin["LitOpenCode plugin inside OpenCode"]
    Plugin --> Agents["lit-loop, lit-plan, lit-implement and skills"]
    Agents --> Record[".litopencode/litgoal/ in your project"]
    Record -->|"/lit-recap, next session"| Agents
```

Install registers the plugin in OpenCode's config (`opencode.jsonc`), copies commands and skills into your OpenCode config folder, and keeps your model routes in `~/.config/opencode/litopencode.json`. The [guide](./docs/guide.md#install) has the details.

## Requirements, updates and removal

**Requirements.** Node.js with npm, and OpenCode with a provider you have already logged in to. On the OpenAI provider, a fresh install plans and reviews with GPT-6 Astra and builds with GPT-6 Luna; you can choose others during install.

**Check the install.** `litopencode doctor` reports whether the plugin and skills are wired up. It only reads and changes nothing.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode doctor
```

**Updates.** LitOpenCode checks for a new release when it starts interactively and after an install or doctor run succeeds. To turn that off, pass `--no-auto-update` or set `LITOPENCODE_NO_AUTO_UPDATE=1`. Running the install command again also updates it, and routes you have customized are kept.

**Uninstall.** Remove the `@litfamily/litopencode` entry from the `plugin` array in OpenCode's `opencode.jsonc`, then restart OpenCode. If you installed it globally, also run:

```sh
npm uninstall -g @litfamily/litopencode
```

The [full removal steps](./docs/guide.md#uninstall) cover the copied commands and skills, and which files to keep if you plan to come back.

## Learn more

- [Guide](./docs/guide.md): install options, a first task and a planned task, automatic handoff, safety and updates, an optional hint that suggests a skill for your prompt (Jev), troubleshooting and full removal.
- [Skills and commands](./docs/skills.md): every route and skill, each with a picture, plus documents, slides, design and browser notes.
- [Screens](./docs/screens.md): what the installer, the health check, the toast and the planner look like, and a 22-second film.
- [Workflow reference](./docs/reference.md): models, permissions, host hooks, every skill, and reproducible verification. In Korean: [한국어 상세 안내](./docs/reference-Ko-KR.md).
- [Migration notes](./docs/migration.md) · [Changelog](./CHANGELOG.md) · [Privacy and network behavior](./docs/privacy.md)
- [Artwork and licenses](./docs/brand.md) · [Terminal mark and activation probes](./docs/lit-mark.md)
- [Release checklist](./docs/release-checklist.md), for maintainers. It stays in this repository and is not part of the npm package.
- [LitFamily hub](https://github.com/wjgoarxiv/litfamily): the same `lit` workflow for Claude Code, Codex CLI, Hermes Agent and Grok Build. Each product installs and runs on its own.

## Contributing and license

If LitOpenCode saves you a morning of "where was I?", a star on GitHub helps other OpenCode users find it.

Bug reports and pull requests are welcome. Start with [Contributing](./CONTRIBUTING.md), and see [Support](./SUPPORT.md), [Security](./SECURITY.md) and the [Code of conduct](./CODE_OF_CONDUCT.md).

MIT. See [LICENSE](./LICENSE). Reference material bundled for `lit-handoff` and `lit-scientific-visualization` keeps its own license and provenance files under `vendor/`.

<details>
<summary>Copy ASCII logo</summary>

```text
                             ▄▄▄▄
                   ▗███▌   ▗██████▖
 ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘
 ▐█████        ▗▟██████▌    ▝▀▜█▀▘
 ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 ▐█████    ▗▟█████████████████████████ ▐█▀
 ▐█████    ████████████████████████████▀
 ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖
 ▐█████    ▀    ▄██ ████▌█████████████▌
 ▐█████       ▄████ ████▌█████████████▌
 ▐█████     ▄█████▛                                 litopencode
 ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖
 ▐█████ ▐█████▀          █████     ▐▛▀
 ▐█████ ▐███▀            █████
 ▐█████ ▐█▀              █████
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

```

</details>

Icons: [Lucide](./docs/assets/readme/Lucide-LICENSE.txt). ASCII glyphs: [JetBrains Mono, OFL](./docs/assets/readme/JetBrainsMono-OFL.txt).
