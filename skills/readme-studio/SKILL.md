---
name: readme-studio
description: "README Studio moved to wjgoarxiv-skills (video-covers). This LitOpenCode pointer gives the OpenCode install lines and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: readme-studio
runtime_class: runtime-skill
static_documentation: true
feature_ids: [readme-studio, doctor-install]
entry_routes: ["native skill readme-studio"]
moved_to: "wjgoarxiv-skills plugins/video-covers/skills/readme-studio/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/readme-studio/"
```

# README Studio: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

readme-studio wrote factual READMEs with an original cover, outlined local type and an optional motion cover. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `video-covers` family, at this path inside a clone of the shelf:

```text
plugins/video-covers/skills/readme-studio/
```

This pointer keeps the name so OpenCode's native skill picker still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for README Studio work (a cover, outlined title type, a motion cover): say it moved, give the four install lines, stop. A plain README text edit needs no skill; do that normally when it is all the user asked. |
| Inside a larger task | Inside a larger lit task: name the missing skill once and do not report a cover as made. |

## #contract.procedure

OpenCode keeps one skill per name, so the copy takes this folder's place. Clone https://github.com/wjgoarxiv/wjgoarxiv-skills once, then run the four lines. The first only lists same-name folders OpenCode reads; move any outside `~/.config/opencode/skills` out of the way (a project's `.opencode/`, `.agents/` and `.claude/` skills too). The second moves this folder whole into a dated backup, the third copies the extension in, the fourth writes its receipt.

```sh
ls -d ~/.config/opencode/skills/readme-studio ~/.agents/skills/readme-studio ~/.claude/skills/readme-studio 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/readme-studio ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/readme-studio "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/readme-studio" ~/.config/opencode/skills/readme-studio
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' readme-studio "<path to your wjgoarxiv-skills clone>/variants/litopencode/readme-studio" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/readme-studio/.litfamily-extension.json
```

With `XDG_CONFIG_HOME` set, use `$XDG_CONFIG_HOME/opencode/` for `~/.config/opencode/`. No skill loads from `extension-backups/`. To update, run the four lines again. Start a new session afterwards. `litopencode install` never overwrites a folder it did not write, and `litopencode doctor` counts the copy as preserved. To remove the copy, run the second line; `litopencode install` then brings this pointer back.

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

Never run the install lines or write into the OpenCode skills root yourself.

## #contract.anti_patterns

Making the deliverable another way as a stand-in, or saying the moved skill ran.
