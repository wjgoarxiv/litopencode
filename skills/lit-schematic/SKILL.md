---
name: lit-schematic
description: "Lit Schematic moved to wjgoarxiv-skills (figures). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: lit-schematic
runtime_class: runtime-skill
static_documentation: true
feature_ids: [lit-schematic]
entry_routes: ["native skill picker lit-schematic", "bare lit P&ID, PFD, schematic or cutaway drawing intent"]
moved_to: "wjgoarxiv-skills plugins/figures/skills/lit-schematic/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/lit-schematic/"
```

# Lit Schematic: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-schematic drew physical schematics of real equipment (P&IDs, PFDs, apparatus figures and isometric cutaways) as editable SVG with a drawing check. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `figures` family, at this path inside a clone of the shelf:

```text
plugins/figures/skills/lit-schematic/
```

This pointer keeps the name so OpenCode's native skill picker and bounded `lit` P&ID, PFD and cutaway requests still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a P&ID, PFD, apparatus figure or cutaway: say it moved, give the two install lines, stop. Draw nothing as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no drawing, and do not report a schematic as drawn. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. Clone the collection once from https://github.com/wjgoarxiv/wjgoarxiv-skills, then:

```sh
rm -r ~/.config/opencode/skills/lit-schematic
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-schematic" ~/.config/opencode/skills/lit-schematic
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
