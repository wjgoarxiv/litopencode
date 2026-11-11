---
name: lit-docx
description: "Lit Word Documents moved to wjgoarxiv-skills (documents). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: lit-docx
runtime_class: runtime-skill
static_documentation: true
feature_ids: [lit-docx]
entry_routes: ["native skill picker lit-docx", "bare lit report intent"]
moved_to: "wjgoarxiv-skills plugins/documents/skills/lit-docx/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/lit-docx/"
```

# Lit Word Documents: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-docx created and edited Word documents (.docx), such as reports, proposals, memos and journal manuscripts, from a Markdown source, with a page-checking gate. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `documents` family, at this path inside a clone of that collection:

```text
plugins/documents/skills/lit-docx/
```

This pointer keeps the name so OpenCode's native skill picker and bare `lit` report requests still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked for a report or document: say it moved, give the two install lines, stop. Write no document source and do not produce a .docx another way as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no document file, and do not report a .docx as made. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. Clone the collection once from https://github.com/wjgoarxiv/wjgoarxiv-skills, then:

```sh
rm -r ~/.config/opencode/skills/lit-docx
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-docx" ~/.config/opencode/skills/lit-docx
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
