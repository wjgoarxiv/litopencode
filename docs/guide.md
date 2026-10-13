# LitOpenCode guide

[README](../README.md) · [한국어](./guide-Ko-KR.md) · [Skills and commands](./skills.md) · [Screens](./screens.md) · [Workflow reference](./reference.md)

The README keeps the short version. This guide has the rest of what a user needs: what install asks and changes, how a first task and a planned task run, automatic handoff, safety and updates, the optional Jev hint, troubleshooting, and a full uninstall.

## Install

You need Node.js with npm, and OpenCode. Then run:

```sh
LIT_PACKAGE='@litfamily/litopencode@latest'
npm exec --package "$LIT_PACKAGE" -- litopencode install
```

Restart OpenCode, press **Tab**, and pick **lit-loop**.

Along the way the installer asks which models to use, how much freedom to give the agents, and how replies should look. Permissions start at `safe`, where OpenCode asks you before acting. Logins and API keys stay with the provider you already set up in OpenCode.

On the OpenAI provider, a fresh install plans and reviews with GPT-6 Astra (`gpt-6-astra`) at `xhigh`, and does the building and research with GPT-6 Luna (`gpt-6-luna`) at `max`. You can pick other supported models and effort levels during install.

If you'd like to see the changes first, or skip the questions, add one of these:

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run  # preview changes
npm exec --package @litfamily/litopencode@latest -- litopencode install --yes     # use defaults; preserve saved choices
```

`--dry-run` prints what it would change and writes nothing. `--yes` skips the questions, takes the defaults, and keeps any choices you saved on an earlier install.

What install actually does is small. It adds the plugin to OpenCode's config and copies LitOpenCode's commands and skills into your OpenCode config folder. Your routes, which say which model handles each kind of work, are kept in `~/.config/opencode/litopencode.json`. If you set `XDG_CONFIG_HOME`, that whole config folder moves with it. Routes you've already customized are left as they are. The [installation and model reference](./reference.md#install) covers custom roots, provider choices, terminal behavior, and unattended setup.

This checkout is `@litfamily/litopencode@1.0.22`. The registry's `@latest` can be different, so run `npm view @litfamily/litopencode version` when the exact version matters.

## Your first task

Start small. Open an empty folder in OpenCode, pick `lit-loop`, and send:

```text
lit Build a to-do list in one index.html with no dependencies; check adding and completing items, then leave results and next steps.
```

Your first result is `index.html`. Open it and try adding and completing an item.

When you come back later, `/lit-recap` reads the record and shows you the next step.

`/lit` starts the same workflow. Bigger jobs are worth planning first. Pick `lit-plan`, read the plan and approve it, run `/start-work`, and finish with `/review-work`. The planner only plans: it waits for explicit user confirmation and has no way to edit files or run shell commands. Once you approve, `lit-implement` carries the plan out.

Everything it records, from progress to the checks it ran, goes into `.litopencode/litgoal/` in your project. OpenCode itself has no place to keep a goal between sessions, so this folder is how the next session knows where you were. Some skills are written guidance only; they come into play when one of their listed routes picks them.

## Automatic handoff

A long conversation eventually fills the model's context window, and whatever falls out is forgotten. Automatic handoff saves your place before that happens. It is off until you turn it on, and the percent is yours to pick: LitOpenCode has no default percent.

Once it is on, LitOpenCode watches how full the context window is. When the conversation reaches your percent and the current turn ends, it asks the model to write a handoff. It then checks that the handoff file was really saved, compacts the conversation, and puts the start of that handoff back in front of the model on the next turn.

OpenCode lets a plugin start compaction, so on OpenCode every step runs by itself:

| Step | On OpenCode |
| --- | --- |
| Notice that your percent was reached | Automatic |
| Ask the model for a handoff | Automatic |
| Check that the handoff was saved | Automatic. Without a saved handoff the conversation is left as it is and a short toast tells you |
| Compact the conversation | Automatic |
| Load the handoff again | Automatic, once, as background notes |

The model writes the handoff, and a model can miss an instruction. That is why the check comes before the compaction. If OpenCode cannot start the compaction, a toast tells you once: "Handoff saved. Run /compact now."

To turn it on, send `lit-handoff auto on 70` as a chat message, or run `/lit-handoff auto on 70`, with the number you want in place of 70. `lit-handoff auto off` turns it off and remembers your number, so a later `lit-handoff auto on` without a number reuses it. `lit-handoff auto status` shows where things stand. The setting is saved in your project's `.litopencode` folder.

If you prefer the environment, set `LITOPENCODE_AUTO_HANDOFF=1` and set `LITOPENCODE_AUTO_HANDOFF_PERCENT` to a whole number from 1 to 99. The environment wins over the saved setting. The config file holds the same two values in an `autoHandoff` block. A percent outside 1 to 99 switches the feature off, and `litopencode doctor` says why.

Pick a percent below the point where OpenCode compacts by itself. With the limits LitOpenCode installs, that point is 90% of the window, and doctor warns when your percent is at or above it, because OpenCode would compact first and the handoff would have no time to run. The [reference](./reference.md#automatic-handoff) lists every setting, what is written to disk, and how the reload works.

## Safety and updates

The planner can only plan. `lit-plan` has its `edit`, `bash` and `task` permissions denied, so it can't change files, run commands or hand work to another agent. You can loosen permissions for the rest of the work by choosing the `balanced` or `yolo` mode on purpose. Even then the planner stays read-only, and a helper agent can't start helpers of its own.

When LitOpenCode fetches a public page, it first checks where the request is going, checks each redirect, and caps how much it downloads. The fetched text is read as data; instructions inside it aren't followed.

LitOpenCode can update itself. On interactive startup, and after an install or doctor run succeeds, it may check for a new release, and it does that in the foreground, so you may wait a moment. To turn automatic updates off, pass `--no-auto-update` or set `LITOPENCODE_NO_AUTO_UPDATE=1`.

Skill learning has been removed. If an earlier release left learning records in a project's `.litopencode` folder, LitOpenCode no longer reads, changes or deletes them; they're yours to keep or remove. [More on that state](./reference.md#skill-learning-state).

## Jev skill hint (optional)

Sometimes the right skill isn't obvious from a prompt. This optional hint asks an outside model for a second opinion. It is off by default.

When you turn it on, each eligible chat turn asks Jev, TypeSafe's hosted typed-decision model, which LitOpenCode skill fits the prompt. If Jev names one of LitOpenCode's own skills with enough confidence, the turn gets one advisory line naming that skill. It's only a suggestion: the model still decides whether to load the skill, and the hint gives no permission and starts no tool. Slash commands, child sessions, turns a lit route already claimed, and prompts under four characters are skipped.

To turn it on, set both variables in the environment that starts OpenCode:

```sh
export LITOPENCODE_JEV=1
export TYPESAFE_API_KEY=<your own TypeSafe key>
```

**Once it's on, each eligible prompt leaves your machine and goes to TypeSafe (typesafe.ai).** Before sending, LitOpenCode cuts the prompt to 2,000 characters and replaces home paths, e-mail addresses and token-shaped strings. It never sends files, tool output or earlier turns. Everything else in the prompt goes as written, so hostnames, customer names, or a password that isn't written as `password=...` would be sent too.

The key needs care as well. Because `TYPESAFE_API_KEY` is exported in the shell that starts OpenCode, the agent's own tools can read it. Make a key just for this feature and give it a low spending limit. TypeSafe bills your own account, at about $0.04 per million input tokens.

The hint never holds a turn up for long. Each request stops after 1.5 seconds and isn't retried; if it fails, the turn carries on as usual, with one short note the first time it happens in a session.

You can always see whether it's working. `litopencode doctor` reports `Jev skill hint: off`, `on`, or `flag on but TYPESAFE_API_KEY missing`, and never shows the key. On the first eligible turn of each session, a `✦ Jev skill hint is ON` toast shows once. When a turn gets a hint, a short toast such as `Jev → lit-humanizer (0.27s)` names the skill and the request time; when the feature is off or no skill fits, nothing pops up. [What you will see](#what-you-will-see) shows each of these.

To turn it off, unset `LITOPENCODE_JEV` or set it to anything other than `1`.

Tuning variables and the debug trace are in the [Jev skill hint reference](./reference.md#jev-skill-hint-optional).

### What you will see

Jev is quiet on screen. When it's on you'll notice two things: a small toast in the top-right corner of OpenCode, and one line in `litopencode doctor`. Here is each one, so you know what to expect before you turn it on.

**In the terminal.** `litopencode doctor` is the quickest check. With nothing set it says the hint is off. Set the flag without a key and it says the key is missing, which is the line to act on if you expected hints and none arrive. With both set it says on. It never prints the key.

<p align="center"><img src="./assets/readme/jev-doctor.webp" width="694" alt="Terminal window showing three runs of litopencode doctor with the Jev line picked out. With nothing set: Jev skill hint: off. After export LITOPENCODE_JEV=1: Jev skill hint: flag on but TYPESAFE_API_KEY missing. After export TYPESAFE_API_KEY=example-key: Jev skill hint: on." /></p>

*Captured from the real `litopencode doctor` in an isolated shell, with the Jev line picked out by `jq`. The key in the picture is a placeholder; doctor only checks that a key exists.*

**The first prompt of a session.** A toast announces that the hint is on. The feature sends prompts out of your machine, so it says so once per session in case you forgot you had switched it on. If Jev has no suggestion for that prompt, this is all you see.

<p align="center"><img src="./assets/readme/jev-toast-notice.webp" width="694" alt="OpenCode home screen with an amber-edged toast in the top-right corner that reads: ✦ Jev skill hint is ON." /></p>

*Sample output: the toast text and style come from the plugin's own toast function, and OpenCode drew it. No request went to TypeSafe.*

**A first prompt that gets a hint.** OpenCode shows one toast at a time, so the notice and the hint share a box. The notice is the title, and the suggested skill and the request time sit below it. The skill and the time here are examples.

<p align="center"><img src="./assets/readme/jev-toast-first-hint.webp" width="694" alt="OpenCode home screen with an amber-edged toast in the top-right corner. Its first line reads: ✦ Jev skill hint is ON. Its second line reads: Jev → lit-humanizer (0.27s)." /></p>

*Sample output, produced the same way. The skill name and the time are examples.*

**Later prompts.** Each prompt that gets a hint shows a quieter toast with only the skill and the time. When no skill fits, or Jev is off, nothing appears.

<p align="center"><img src="./assets/readme/jev-toast-hint.webp" width="694" alt="OpenCode home screen with a teal-edged toast in the top-right corner that reads: Jev → lit-humanizer (0.27s)." /></p>

*Sample output, produced the same way. The skill name and the time are examples.*

The suggestion itself is one sentence naming the skill. It goes to the model and isn't shown as something you typed.

## Troubleshooting

If the result doesn't match what the agent reported, tell it what you actually saw.

To check that the package is installed and your configuration is sound, run:

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode doctor
```

The [installation and model reference](./reference.md#install) goes deeper.

Two skills-folder setups can surprise you, and install and `doctor` point out both. The first is a skills folder, `<root>/skills`, that is a symlink to somewhere else. Install follows the link and writes LitOpenCode's skill folders wherever it points, so you get a warning when that place is inside a git repository. The second is a skill with the same name in another folder OpenCode reads, such as `~/.agents/skills`, `~/.claude/skills` or a project skills folder. OpenCode may load that copy instead of LitOpenCode's. See [symlinked native skills root and shadow copies](./reference.md#symlinked-native-skills-root-and-shadow-copies).

## Uninstall

There's no `litopencode uninstall` command. Removing it by hand takes a few steps:

1. Delete the `@litfamily/litopencode` or `@litfamily/litopencode@<version>` entry from the `plugin` array in OpenCode's `opencode.jsonc` (or a custom root's `opencode.json`). Remove any legacy `litopencode` package entries too.
2. If you installed it globally, remove the npm binary:

   ```sh
   npm uninstall -g @litfamily/litopencode
   ```

3. Look over the installed command and skill files before you remove the installer's copies, and keep anything you created or edited.
4. Restart OpenCode.

Keep `litopencode.json` if you still want its routes, and keep a project's `.litopencode/` records if you plan to resume. The [removal reference](./reference.md#remove) has the details.

## License and bundled sources

MIT. See [LICENSE](../LICENSE).

The reference material bundled for `lit-handoff` and `lit-scientific-visualization` lives in `vendor/handoff/` and `vendor/scientific-visualization/`. Their numbered license and provenance files are kept as source attribution.
