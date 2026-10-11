<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitOpenCode

**LitOpenCode is a workflow plugin for OpenCode. Add `lit` to a prompt and the work gets planned, built, checked and written down, so the next session knows where you stopped.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.18" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
<a href="./docs/guide.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp; <a href="./docs/screens.md"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Screens</a> &nbsp; <a href="./docs/skills.md">Skills</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a> &nbsp; <a href="./README-Ko-KR.md">한국어</a>
</p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="A short film of a real OpenCode session in a small Node project, with the waiting shortened and a camera moving across the terminal. On the start screen the Lit-Loop agent is selected and the prompt &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot; is typed and sent. A toast with the LIT mark and &quot;🔥 LIT IGNITED · lit-task 🔥&quot; appears beside the prompt. The agent reads package.json, greet.js and test/greet.test.js, runs npm test, patches test/greet.test.js with a --shout test, runs npm test again and node greet.js Ada --shout, which prints HELLO, ADA!, then sums up: Added --shout to greet.js, Tests pass: 2 tests. The film ends on the LitOpenCode mark and the install command." /></p> <!-- demo-gif -->

*A real OpenCode 1.18.35 session with LitOpenCode installed, recorded in a terminal and replayed on a drawn terminal window with camera moves. Waiting time is shortened and the project folder is shown as `~/greet`; the rest is as OpenCode printed it. [Screens](./docs/screens.md) shows the installer, the toast, the health check, the planner's locked permissions and a short film.*

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

Restart OpenCode, press **Tab**, and pick **lit-loop**. Then open an empty folder and send your first task:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

**What you will see.** For six seconds a toast appears that reads `🔥 LIT IGNITED` with the name of the workflow that started, which tells you LitOpenCode picked up your prompt. When the work is done you have an `index.html` to open and try, and a record of what was built and checked in `.litopencode/litgoal/`. Come back another day, type `/lit-recap`, and it tells you what was done and what comes next.

The model inside OpenCode does the work, and a model can be wrong. When a reply says something passed, open the file and look for yourself.

## What you get

**Start with one word.** Put `lit` at the end of any request, or type `/lit`. The task is framed, planned, built, verified and recapped, and each step leaves a note you can read later.

```text
Add a dark-mode toggle to the settings page and keep the existing tests passing lit
```

**Plan first when the job is big.** Press Tab and pick `lit-plan`. The planner reads your project and writes a checklist, then waits for explicit user confirmation; it cannot edit files, run shell commands or hand work to another agent. Run `/start-work` to carry the approved plan out one slice at a time, and `/review-work` to have the change looked at from five angles, worst findings first.

**Pick up where you stopped.** Type a bare `handoff`, or `/lit-handoff`, to leave a continuation file for the next session, and `/lit-recap` to read back what is done, what is blocked and what is next. If you like, [automatic handoff](./docs/guide.md#automatic-handoff) writes the handoff for you before the context window fills up.

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
