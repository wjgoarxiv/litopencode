---
name: frontend-ui-ux
description: "Frontend UI/UX moved to wjgoarxiv-skills (design). This LitOpenCode pointer gives the OpenCode install lines and builds nothing."
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

# Frontend UI/UX: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

frontend-ui-ux built and inspected interfaces (pages, screens, components) from a locked house style and design kit, with a page probe across viewports. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `design` family, at this path inside a clone of the shelf:

```text
plugins/design/skills/frontend-ui-ux/
```

This pointer keeps the name so OpenCode's native skill picker, interface requests in chat and the post-edit hint still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked to build, restyle or audit an interface: say it moved, give the four install lines, stop. Build no page from this pointer. |
| Inside a larger task | Inside lit-loop or an approved plan that changes a web interface: name the missing skill once, do the work that is not interface work, and report the interface slice as unverified, because there is no page probe without the installed skill. |

## #contract.procedure

OpenCode keeps one skill per name, so the copy takes this folder's place. Clone https://github.com/wjgoarxiv/wjgoarxiv-skills once, then run the four lines. The first only lists same-name folders OpenCode reads; move any outside `~/.config/opencode/skills` out of the way (a project's `.opencode/`, `.agents/` and `.claude/` skills too). The second moves this folder whole into a dated backup, the third copies the extension in, the fourth writes its receipt.

```sh
ls -d ~/.config/opencode/skills/frontend-ui-ux ~/.agents/skills/frontend-ui-ux ~/.claude/skills/frontend-ui-ux 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/frontend-ui-ux ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/frontend-ui-ux "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/frontend-ui-ux" ~/.config/opencode/skills/frontend-ui-ux
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' frontend-ui-ux "<path to your wjgoarxiv-skills clone>/variants/litopencode/frontend-ui-ux" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/frontend-ui-ux/.litfamily-extension.json
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
