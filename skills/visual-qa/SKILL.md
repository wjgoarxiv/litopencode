---
name: visual-qa
description: "Visual QA moved to wjgoarxiv-skills (design). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: visual-qa
runtime_class: runtime-skill
static_documentation: true
feature_ids: [visual-qa, doctor-install]
entry_routes: ["chat.message visual-qa", "native skill visual-qa", "tool.execute.after advisory"]
moved_to: "wjgoarxiv-skills plugins/design/skills/visual-qa/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/visual-qa/"
```

# Visual QA: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

visual-qa checked rendered interfaces against captured evidence: screenshots across viewports and states, an evidence manifest and a review receipt. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `design` family, at this path inside a clone of that collection:

```text
plugins/design/skills/visual-qa/
```

This pointer keeps the name so OpenCode's native skill picker, `visual-qa` mentions in chat and the post-edit hint still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked to check how a surface looks or behaves: say it moved, give the two install lines, stop. Claim no PASS and no FAIL. |
| Inside a larger task | Inside a workflow or a review: record visual-qa as missing and give no visual verdict. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. The collection is not published yet; a local clone is the only source:

```sh
rm -r ~/.config/opencode/skills/visual-qa
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/visual-qa" ~/.config/opencode/skills/visual-qa
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
