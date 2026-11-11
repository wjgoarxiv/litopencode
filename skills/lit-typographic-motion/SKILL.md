---
name: lit-typographic-motion
description: "Film director moved to wjgoarxiv-skills (video-covers). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
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

# Film director: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-typographic-motion directed short films from a written treatment (stage films, kinetic type, title sequences) and silent README cover loops, each checked and looked at. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `video-covers` family, at this path inside a clone of that collection:

```text
plugins/video-covers/skills/lit-typographic-motion/
```

This pointer keeps the name so OpenCode's native skill picker and bounded `lit` film requests still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a film, a kinetic type piece or a cover loop: say it moved, give the two install lines, stop. Render nothing and do not encode a video another way as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no film, and do not report a film as made. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. Clone the collection once from https://github.com/wjgoarxiv/wjgoarxiv-skills, then:

```sh
rm -r ~/.config/opencode/skills/lit-typographic-motion
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-typographic-motion" ~/.config/opencode/skills/lit-typographic-motion
```

With `XDG_CONFIG_HOME` set, use `$XDG_CONFIG_HOME/opencode/skills/`. The copy then needs its fonts and pinned engine packages once (network, about 20 MB into the user cache), from a normal terminal: `node ~/.config/opencode/skills/lit-typographic-motion/runtime.mjs install`. Start a new session afterwards. `litopencode install` never overwrites a folder it did not write, and `litopencode doctor` counts the copy as preserved. To return to this pointer, delete the folder and run `litopencode install`.

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
