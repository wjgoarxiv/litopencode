---
name: lit-diagram-drawer
description: "Diagram Drawer moved to wjgoarxiv-skills (figures). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: lit-diagram-drawer
runtime_class: runtime-skill
static_documentation: true
feature_ids: [lit-diagram-drawer]
entry_routes: ["native skill picker lit-diagram-drawer", "bounded lit diagram request"]
moved_to: "wjgoarxiv-skills plugins/figures/skills/lit-diagram-drawer/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/lit-diagram-drawer/"
```

# Diagram Drawer: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-diagram-drawer drew editable, accessible diagrams (architecture maps, workflows, data models, timelines) and exported them for slides and documents. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `figures` family, at this path inside a clone of that collection:

```text
plugins/figures/skills/lit-diagram-drawer/
```

This pointer keeps the name so OpenCode's native skill picker and bounded `lit` diagram requests still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a diagram: say it moved, give the two install lines, stop. Draw nothing and do not hand-write SVG or Mermaid as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no diagram, and do not report a diagram as drawn. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. The collection is not published yet; a local clone is the only source:

```sh
rm -r ~/.config/opencode/skills/lit-diagram-drawer
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-diagram-drawer" ~/.config/opencode/skills/lit-diagram-drawer
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
