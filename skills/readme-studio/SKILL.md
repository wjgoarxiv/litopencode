---
name: readme-studio
description: "README Studio moved to wjgoarxiv-skills (video-covers). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
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

# README Studio: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

readme-studio wrote factual READMEs with an original cover, outlined local type and an optional motion cover. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `video-covers` family, at this path inside a clone of that collection:

```text
plugins/video-covers/skills/readme-studio/
```

This pointer keeps the name so OpenCode's native skill picker still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for README Studio work (a cover, outlined title type, a motion cover): say it moved, give the two install lines, stop. A plain README text edit needs no skill; do that normally when it is all the user asked. |
| Inside a larger task | Inside a larger lit task: name the missing skill once and do not report a cover as made. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. The collection is not published yet; a local clone is the only source:

```sh
rm -r ~/.config/opencode/skills/readme-studio
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/readme-studio" ~/.config/opencode/skills/readme-studio
```

With `XDG_CONFIG_HOME` set, use `$XDG_CONFIG_HOME/opencode/skills/`. Start a new session afterwards. `litopencode install` never overwrites a folder it did not write, and `litopencode doctor` counts the copy as preserved. To return to this pointer, delete the folder and run `litopencode install`.

## #contract.outputs

A short reply: where the skill went and the two install lines.

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
