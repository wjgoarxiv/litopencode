---
name: frontend-ui-ux
description: "Frontend UI/UX moved to wjgoarxiv-skills (design). This LitOpenCode pointer gives the one OpenCode install line and builds nothing."
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: frontend-ui-ux
runtime_class: runtime-skill
static_documentation: true
feature_ids: [frontend-ui-ux, doctor-install]
entry_routes: ["chat.message design intent", "native skill frontend-ui-ux", "tool.execute.after advisory"]
moved_to: "wjgoarxiv-skills plugins/design/skills/frontend-ui-ux/"
opencode_copy: "wjgoarxiv-skills variants/litopencode/frontend-ui-ux/"
```

# Frontend UI/UX: moved to wjgoarxiv-skills

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

frontend-ui-ux built and inspected interfaces (pages, screens, components) from a locked house style and design kit, with a page probe across viewports. LitOpenCode no longer ships it. It now lives in wjgoarxiv-skills, the separate collection of content skills, in the `design` family, at this path inside a clone of that collection:

```text
plugins/design/skills/frontend-ui-ux/
```

This pointer keeps the name so OpenCode's native skill picker, interface requests in chat and the post-edit hint still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked to build, restyle or audit an interface: say it moved, give the two install lines, stop. Build no page from this pointer. |
| Inside a larger task | Inside lit-loop or an approved plan that changes a web interface: name the missing skill once, do the work that is not interface work, and report the interface slice as unverified, because there is no page probe without the installed skill. |

## #contract.procedure

OpenCode keeps one skill per name and loads same-name folders in no fixed order, so the copy replaces this folder. Clone the collection once from https://github.com/wjgoarxiv/wjgoarxiv-skills, then:

```sh
rm -r ~/.config/opencode/skills/frontend-ui-ux
cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/frontend-ui-ux" ~/.config/opencode/skills/frontend-ui-ux
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
