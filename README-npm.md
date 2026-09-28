<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>

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

# LitOpenCode

[English](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/README.md) · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/README-Ko-KR.md)

**Keep the work lit.**

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/badge-version.svg" alt="1.0.11" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>

LitOpenCode adds workflow agents, slash commands, and a local evidence ledger to OpenCode.

Add `lit` to a prompt and it plans, builds, checks, and writes down the next step in your project, so a later session can pick up where this one stopped. OpenCode still runs the model and asks the permission questions.

**[Full guide, skills gallery and A/B results on GitHub →](https://github.com/wjgoarxiv/litopencode#readme)**

## Install

You need Node.js with npm, and OpenCode.

```sh
LIT_PACKAGE='@litfamily/litopencode@latest'
npm exec --package "$LIT_PACKAGE" -- litopencode install
```

Restart OpenCode, press **Tab**, and pick **lit-loop**. Permissions default to safe/ask-first, and model access comes from your OpenCode provider setup.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run  # preview changes
npm exec --package @litfamily/litopencode@latest -- litopencode install --yes     # use defaults; preserve saved choices
```

## Your first task

Open an empty folder in OpenCode, pick `lit-loop`, and send:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

You get an `index.html` to open and try. Next time, `/lit-recap` shows where you left off.

## The routes you'll use

| Type | What happens |
| --- | --- |
| `lit` or `/lit` | Start a bounded task and record what was checked. |
| `lit-plan` → `/start-work` → `/review-work` | Plan, approve, execute, and review. The planner can't edit files or run shell commands. |
| `handoff` or `/lit-handoff` | Carry the current result and next step into another session. |
| `/lit-recap` | Read a short recap from local state. |
| `/litresearch` | Research with source evidence. |

Beyond these, the package installs skills for debugging, refactoring, code review, research, Word reports (`lit-docx`), PowerPoint decks (`lit-pptx`), diagrams, scientific figures, interfaces, READMEs, and prose editing (`/lit-humanizer`). Each one, with a picture of what it produces, is in the [skills gallery on GitHub](https://github.com/wjgoarxiv/litopencode#skills-at-a-glance).

## How it compared

Ten casual Korean prompts went to plain OpenCode and to LitOpenCode; the LitOpenCode side only added ` lit` to the same line. The final verdict went to LitOpenCode on all ten. For nine of them that was the maintainer's call after comparing both outputs side by side; the one the maintainer didn't review by eye keeps the blind judge's verdict. The blind judge on its own, comparing outputs with product markings removed, scored LitOpenCode 4 wins, 3 ties, and 3 losses. The tasks, both verdicts, and screenshots of each side are in the [A/B results on GitHub](https://github.com/wjgoarxiv/litopencode#ab-results).

## What install changes

It registers the plugin and writes native command and skill files under your OpenCode config root. Routes live in `~/.config/opencode/litopencode.json` (`XDG_CONFIG_HOME` moves that root), and custom routes you already have stay yours. Work records go to `.litopencode/litgoal/` inside each project.

With the OpenAI provider, a fresh install uses GPT-6 Astra (`gpt-6-astra`) at `xhigh` for planning and review, and GPT-6 Luna (`gpt-6-luna`) at `max` for execution and research.

## Safety and updates

- `lit-plan` keeps `edit`, `bash`, and `task` denied; `balanced` and `yolo` are opt-in and don't lift that guard.
- Turn automatic updates off with `--no-auto-update` or `LITOPENCODE_NO_AUTO_UPDATE=1`.
- Skill learning has been removed. Records that earlier releases left in a project's `.litopencode` folder are inert.
- The optional Jev skill hint is off by default. Turning it on sends eligible prompts to TypeSafe; read the [Jev skill hint reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference.md#jev-skill-hint-optional) first.
- `npm exec --package @litfamily/litopencode@latest -- litopencode doctor` checks the package and your configuration.

## Uninstall

There's no uninstall command. Remove the `@litfamily/litopencode` entry from the `plugin` array in OpenCode's `opencode.jsonc` (or a custom root's `opencode.json`), then restart OpenCode. If you installed it globally:

```sh
npm uninstall -g @litfamily/litopencode
```

The [removal reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference.md#remove) covers the installed files and records you may want to keep.

## More

- [Full guide on GitHub](https://github.com/wjgoarxiv/litopencode#readme)
- [Workflow reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference.md) · [한국어 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference-Ko-KR.md)
- [Migration notes](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/CHANGELOG.md) · [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/privacy.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/LICENSE) · [ASCII font license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/JetBrainsMono-OFL.txt)
