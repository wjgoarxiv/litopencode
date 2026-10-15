<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitOpenCode

**LitOpenCode is a workflow plugin for OpenCode. Add `lit` to a prompt and the work gets planned, built, checked and written down, so the next session knows where you stopped.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/assets/readme/badge-version.svg" alt="1.0.24" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="npm downloads per month" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub stars" /></a>
</p>

LitOpenCode keeps the goal, the plan, what was checked and the next step in `.litopencode/litgoal/` inside your project, so a long task picks up the next day where it stopped.

**[Full guide, screens and skills gallery on GitHub →](https://github.com/wjgoarxiv/litopencode#readme)**

## Quick start

You need Node.js with npm, and OpenCode with a model provider set up.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

Add `--yes` to take the defaults, or `--dry-run` to preview without writing anything. Restart OpenCode, press **Tab**, pick **lit-loop**, open an empty folder and send:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

You get an `index.html` to try, and next time `/lit-recap` shows where you left off.

## What you get

| You enter | What happens |
| --- | --- |
| `lit` or `/lit` | Plan, build, verify and recap a task, with a note at each step. |
| `lit-plan` → `/start-work` → `/review-work` | Plan, approve, build and review. The planner cannot edit files. |
| `handoff` · `/lit-recap` | Leave a continuation file for the next session, and read back what is done and what is next. |
| `/litresearch` | Research in rounds with a source for each claim. |
| `lit` + report or slides | An editable Word report or PowerPoint deck with its Markdown source. |
| `/lit-humanizer` | Rewrite stiff English or Korean prose and keep the facts. |

Each skill is pictured in the [skills gallery on GitHub](https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills.md).

## Updates and removal

LitOpenCode checks for updates on interactive start and after a successful install or doctor run. To turn that off, pass `--no-auto-update` or set `LITOPENCODE_NO_AUTO_UPDATE=1`. `npm exec --package @litfamily/litopencode@latest -- litopencode doctor` checks the setup and changes nothing.

To remove it, delete the `@litfamily/litopencode` entry from the `plugin` array in OpenCode's `opencode.jsonc` and restart OpenCode. If you installed it globally:

```sh
npm uninstall -g @litfamily/litopencode
```

## More

- [Guide on GitHub](https://github.com/wjgoarxiv/litopencode/blob/main/docs/guide.md): install options, automatic handoff, troubleshooting and removal.
- [Workflow reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/reference.md)
- [Migration notes](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/CHANGELOG.md) · [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/privacy.md)
- [LitFamily hub](https://github.com/wjgoarxiv/litfamily) · [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/LICENSE) · [ASCII font license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.24/docs/assets/readme/JetBrainsMono-OFL.txt)

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
