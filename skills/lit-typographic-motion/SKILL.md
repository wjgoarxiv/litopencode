---
name: lit-typographic-motion
description: "Film director moved to wjgoarxiv-skills (video-covers). This LitOpenCode pointer gives the OpenCode install lines and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: lit-typographic-motion
runtime_class: runtime-skill
static_documentation: true
feature_ids: [lit-typographic-motion]
entry_routes: ["native skill picker lit-typographic-motion", "bare lit film request"]
moved_to: "wjgoarxiv-skills plugins/video-covers/skills/lit-typographic-motion/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/lit-typographic-motion/"
```

# Film director: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-typographic-motion directed short films from a written treatment (stage films, kinetic type, title sequences) and silent README cover loops, each checked and looked at. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `video-covers` family, at this path inside a clone of the shelf:

```text
plugins/video-covers/skills/lit-typographic-motion/
```

This pointer keeps the name so OpenCode's native skill picker and bounded `lit` film requests still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a film, a kinetic type piece or a cover loop: say it moved, give the four install lines, stop. Render nothing and do not encode a video another way as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no film, and do not report a film as made. |

## #contract.procedure

OpenCode keeps one skill per name, so the copy takes this folder's place. `litopencode extensions install lit-typographic-motion --yes` does it for you; `update` and `remove` work alike. By hand, clone https://github.com/wjgoarxiv/wjgoarxiv-skills once, then run the four lines. The first only lists same-name folders OpenCode reads; move any outside `~/.config/opencode/skills` out of the way (a project's `.opencode/`, `.agents/` and `.claude/` skills too). The second moves this folder whole into a dated backup, the third copies the extension in, the fourth writes its receipt.

```sh
ls -d ~/.config/opencode/skills/lit-typographic-motion ~/.agents/skills/lit-typographic-motion ~/.claude/skills/lit-typographic-motion 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/lit-typographic-motion ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/lit-typographic-motion "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-typographic-motion" ~/.config/opencode/skills/lit-typographic-motion
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' lit-typographic-motion "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-typographic-motion" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/lit-typographic-motion/.litfamily-extension.json
```

With `XDG_CONFIG_HOME` set, use `$XDG_CONFIG_HOME/opencode/` for `~/.config/opencode/`. No skill loads from `extension-backups/`. To update, run the four lines again. The copy then needs its fonts and pinned engine packages once (network, about 20 MB into the user cache), from a normal terminal: `node ~/.config/opencode/skills/lit-typographic-motion/runtime.mjs install`. Start a new session afterwards. `litopencode install` never overwrites a folder it did not write, and `litopencode doctor` counts the copy as preserved. To remove the copy, run the second line; `litopencode install` then brings this pointer back.

## #contract.outputs

A short reply: where the skill went and the four install lines.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

The reply is the evidence. If the user says the copy is installed and this pointer still loaded, the step is blocked: the copy is not in that folder.

## #contract.hard_stops

Never run these lines or commands, or write into the OpenCode skills root yourself.

## #contract.anti_patterns

Making the deliverable another way as a stand-in, or saying the moved skill ran.
