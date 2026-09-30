<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>

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

[English](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/README.md) · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/README-Ko-KR.md)

**Keep the work lit.**

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/readme/badge-version.svg" alt="1.0.15" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>

LitOpenCode adds workflow agents, slash commands, and a local evidence ledger to OpenCode.

Add `lit` to a prompt and it plans, builds, checks, and writes down the next step in your project, so a later session can pick up where this one stopped. OpenCode still runs the model and asks for permission the way it always has.

**[Full guide and skills gallery on GitHub →](https://github.com/wjgoarxiv/litopencode#readme)**

## Install

You need Node.js with npm, and OpenCode.

```sh
LIT_PACKAGE='@litfamily/litopencode@latest'
npm exec --package "$LIT_PACKAGE" -- litopencode install
```

Restart OpenCode, press **Tab**, and pick **lit-loop**. Permissions start at `safe`, where OpenCode asks you before acting. Logins and API keys stay with the provider you already set up in OpenCode.

To see the changes first, add `--dry-run`; it writes nothing. To skip the questions, add `--yes`; it takes the defaults and keeps choices you saved before.

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
| `lit` or `/lit` | Start a task with a clear scope and record what was checked. |
| `lit-plan` → `/start-work` → `/review-work` | Plan, approve, execute, and review. The planner can't edit files or run shell commands. |
| `handoff` or `/lit-handoff` | Carry the current result and next step into another session. |
| `/lit-recap` | Read a short recap from local state. |
| `/litresearch` | Research with source evidence. |

Beyond these, the package installs skills for debugging, refactoring, code review, research, Word reports (`lit-docx`), PowerPoint decks (`lit-pptx`), diagrams, scientific figures, interfaces, READMEs, and prose editing (`/lit-humanizer`). Each one, with a picture of what it produces, is in the [skills gallery on GitHub](https://github.com/wjgoarxiv/litopencode#skills-at-a-glance).

## What install changes

Not much. Install adds the plugin to OpenCode's config and copies LitOpenCode's commands and skills into your OpenCode config folder. Your routes, which say which model handles each kind of work, are kept in `~/.config/opencode/litopencode.json`. Setting `XDG_CONFIG_HOME` moves that folder, and routes you've already customized are left as they are. Each project keeps its work record in `.litopencode/litgoal/`, and that record is what a later session reads to carry on.

With the OpenAI provider, a fresh install uses GPT-6 Astra (`gpt-6-astra`) at `xhigh` for planning and review, and GPT-6 Luna (`gpt-6-luna`) at `max` for execution and research.

## Safety and updates

- The planner only plans. `lit-plan` has `edit`, `bash` and `task` denied, and it stays that way even if you choose the looser `balanced` or `yolo` mode.
- LitOpenCode can update itself when it starts interactively and after an install or doctor run succeeds. To turn that off, pass `--no-auto-update` or set `LITOPENCODE_NO_AUTO_UPDATE=1`.
- Skill learning has been removed. Learning records an earlier release left in a project's `.litopencode` folder are no longer used; keep or delete them as you like.
- The Jev skill hint is optional and off by default. Turning it on sends eligible prompts to TypeSafe, so read the [Jev skill hint reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/reference.md#jev-skill-hint-optional) first. The GitHub page shows [what the toast and the doctor line look like](https://github.com/wjgoarxiv/litopencode#what-you-will-see).
- If something seems off, `npm exec --package @litfamily/litopencode@latest -- litopencode doctor` checks the package and your configuration.

## Uninstall

There's no uninstall command. Remove the `@litfamily/litopencode` entry from the `plugin` array in OpenCode's `opencode.jsonc` (or a custom root's `opencode.json`), then restart OpenCode. If you installed it globally:

```sh
npm uninstall -g @litfamily/litopencode
```

The [removal reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/reference.md#remove) covers the installed files and records you may want to keep.

## More

- [Full guide on GitHub](https://github.com/wjgoarxiv/litopencode#readme)
- [Workflow reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/reference.md) · [한국어 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/reference-Ko-KR.md)
- [Migration notes](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/CHANGELOG.md) · [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/privacy.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/LICENSE) · [ASCII font license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.15/docs/assets/readme/JetBrainsMono-OFL.txt)
