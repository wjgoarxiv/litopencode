---
name: lit-scientific-visualization
description: "Scientific Visualization moved to wjgoarxiv-skills (figures). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: lit-scientific-visualization
runtime_class: runtime-skill
static_documentation: true
feature_ids: [lit-scientific-visualization, doctor-install]
entry_routes: ["/lit-scientific-visualization", "exact bare lit-scientific-visualization", "native skill picker lit-scientific-visualization"]
moved_to: "wjgoarxiv-skills plugins/figures/skills/lit-scientific-visualization/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/lit-scientific-visualization/"
```

# Scientific Visualization: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-scientific-visualization made publication-ready scientific figures from measured data, following the scientific-visualization source it adapted. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `figures` family, at these paths inside a clone of that collection:

```text
plugins/figures/skills/lit-scientific-visualization/
plugins/figures/vendor/scientific-visualization/
```

The second path is the scientific-visualization source it adapted; the OpenCode copy keeps that source inside its own folder.

This pointer keeps the name so OpenCode's native skill picker, `/lit-scientific-visualization` and the exact bare `lit-scientific-visualization` message still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a figure: say it moved, give the two install lines, stop. Plot nothing and do not write a plotting script as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no figure, and do not report a figure as made. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. Clone the collection once from https://github.com/wjgoarxiv/wjgoarxiv-skills, then:

```sh
rm -r ~/.config/opencode/skills/lit-scientific-visualization
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-scientific-visualization" ~/.config/opencode/skills/lit-scientific-visualization
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
