<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitOpenCode

**LitOpenCode is an add-on for OpenCode. It makes the agent check its own work before it says "done", and leaves a note so the next session starts where this one stopped.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/assets/readme/badge-version.svg" alt="1.0.52" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="npm downloads per month" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub stars" /></a>
</p>

You ask OpenCode for a feature. It writes the code and says it is finished, and a day later you find the tests never ran. You open a new session and explain the whole project again. With LitOpenCode you add `lit` to the same request. The agent reads the code first, makes the change, runs the tests that cover it, and ends by telling you what it checked and what it could not. For a longer job, write `lit loop`: it first writes down what "finished" means as checks in `.litopencode/litgoal/` and keeps going until they pass. When you stop, type `handoff`. The agent saves a note in `HANDOFF.md`, and the next session reads it and carries on.

**[Full guide, screens and skills gallery on GitHub →](https://github.com/wjgoarxiv/litopencode#readme)**

## Two ways to use it

**The easy way.** Restart OpenCode after you install. It opens on the `lit-loop` agent, and Tab switches agents if another one is showing. Write your request as usual and put `lit` at the start or the end, for example `fix the date parsing bug in src/dates.js lit`. A toast reads `🔥 LIT IGNITED`, then the agent fixes the bug, runs the tests and tells you what it checked. Ending with `lit` works the same as starting with it. When the project has a test command, LitOpenCode asks one goal question and takes the words before `lit` as the goal, so `fix the login redirect lit` offers the goal `fix the login redirect`; answer `yes` to set it. `lit loop`, `lit-loop` and `litwork` work at either end as well, and `/lit-loop <task>` and `/litwork <task>` ask the same question. The `lit-plan` agent treats the same line as a planning request, so stay on `lit-loop` for building.

**The full workflow.** For a bigger job, go one step at a time. Each step hands its result to the next, and you can skip any step you do not need.

| Step | Type | What happens |
| --- | --- | --- |
| 1. Explore | `/lit-brainstorm <question>` | Many options, scored and cut to a short list |
| 2. Clarify | `/deep-interview <idea>` | The agent reads the repository, then asks what the code cannot answer until the goal is clear |
| 3. Plan | `/lit-crucible <approach>` or `/lit-plan <task>` | Crucible attacks the approach first and hands what survives to lit-plan; lit-plan writes a checklist and waits for your yes |
| 4. Build | `/start-work` once you approve the plan, or `/lit-loop <task>` | The work goes one slice at a time, with tests and checks |
| 5. Review | `/review-work` | Five angles on the change, worst findings first |
| 6. Hand off | `handoff` | Decisions and the next step, saved to `HANDOFF.md` |

Install with one line, `npm exec --package @litfamily/litopencode@latest -- litopencode install`, then restart OpenCode. [Quick start](#quick-start) has the full first run.

## Quick start

You need Node.js with npm, and OpenCode with a model provider set up: OpenCode 1 (1.18.29 or later), OpenCode 2, or both side by side, with OpenCode 1 run as `opencode` and OpenCode 2 as `opencode2`. The installer finds the ones you have and sets up each.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

Add `--dry-run` to see what would change before anything is written, or `--yes` to take the defaults and skip the questions. Restart OpenCode, press **Tab**, pick **lit-loop**, open an empty folder and send:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

You get an `index.html` to try, and next time `/lit-adhd` shows what changed and the one thing to do next.

The installer's model menu lists every provider OpenCode knows, including one you added yourself in `opencode.json`. Later, `/lit-model` in a chat shows the same numbered list and saves your pick for every new session.

## What you get

| You enter | What happens |
| --- | --- |
| `lit` or `/lit` | Plan, build, verify and recap a task, with a note at each step. |
| `lit-plan` → `/start-work` → `/review-work` | Plan, approve, build and review. The planner cannot edit files. |
| `handoff` · `/lit-adhd` | Leave a continuation file for the next session, and come back to a short card: what changed, the one thing to do, what to type. `lit adhd recap` reads back each session. |
| `/ultra-brainstorm` | Ask a hundred or more cheap idea lanes at once, after one question about the count and the cost. |
| `lit team <goal>` | This session splits the goal, runs a small team of subagents (or worktrees, or herdr panes) and returns one report. |
| `/litresearch` | Research in rounds with a source for each claim. |
| `lit` + report or slides | Points you to the deck and document skills, which moved to the separate wjgoarxiv-skills collection. |
| `/lit-humanizer` | Rewrite stiff English or Korean prose and keep the facts. |

Each skill is pictured in the [skills gallery on GitHub](https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills.md).

## Extensions

LitOpenCode's core is complete and works on its own. Nine skills that make files (decks, documents, figures, design and video covers) are LitFamily extensions, kept on the extension shelf [wjgoarxiv-skills](https://github.com/wjgoarxiv/wjgoarxiv-skills). Install the ones you use alongside LitOpenCode to get the full LitFamily experience. `litopencode extensions install <skill>` does it for you: it stops if OpenCode also reads a same-name skill elsewhere, prints its plan, and acts only with `--yes`; `list`, `check`, `update`, `remove` and `prune-backups` work the same way. By hand, clone the shelf once, then for each skill run these four lines. They list same-name copies, move the pointer folder whole into a dated backup that OpenCode never reads (nothing is deleted), copy the extension in and write its receipt. Run them again to update.

```sh
ls -d ~/.config/opencode/skills/<skill> ~/.agents/skills/<skill> ~/.claude/skills/<skill> 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/<skill> ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/<skill> "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" ~/.config/opencode/skills/<skill>
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' <skill> "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/<skill>/.litfamily-extension.json
```

## Updates and removal

LitOpenCode checks for updates on interactive start and after a successful install or doctor run. If you'd rather choose when to update, pass `--no-auto-update` or set `LITOPENCODE_NO_AUTO_UPDATE=1`. `npm exec --package @litfamily/litopencode@latest -- litopencode doctor` checks the setup and changes nothing.

To remove it, delete the `@litfamily/litopencode` entry from the `plugin` array in OpenCode's `opencode.jsonc` and restart OpenCode. If you installed it globally:

```sh
npm uninstall -g @litfamily/litopencode
```

## More

- [Guide on GitHub](https://github.com/wjgoarxiv/litopencode/blob/main/docs/guide.md): install options, automatic handoff, troubleshooting and removal.
- [Workflow reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/reference.md)
- [Migration notes](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/CHANGELOG.md) · [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/privacy.md)
- [LitFamily hub](https://github.com/wjgoarxiv/litfamily) · [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/LICENSE) · [Trademark policy](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/TRADEMARK.md) · [ASCII font license](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.52/docs/assets/readme/JetBrainsMono-OFL.txt)

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
