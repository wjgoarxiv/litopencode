---
name: visual-qa
description: "Visual QA moved to wjgoarxiv-skills (design). This LitOpenCode pointer gives the OpenCode install lines and builds nothing."
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

# Visual QA: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

visual-qa checked rendered interfaces against captured evidence: screenshots across viewports and states, an evidence manifest and a review receipt. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `design` family, at this path inside a clone of the shelf:

```text
plugins/design/skills/visual-qa/
```

This pointer keeps the name so OpenCode's native skill picker, `visual-qa` mentions in chat and the post-edit hint still land on a page that says where it went.

## #contract.inputs

The request that loaded this pointer. Nothing else is read.

## #contract.mode_matrix

| Mode | Reply |
| --- | --- |
| Direct request | Asked to check how a surface looks or behaves: say it moved, give the four install lines, stop. Claim no PASS and no FAIL. |
| Inside a larger task | Inside a workflow or a review: record visual-qa as missing and give no visual verdict. |

## #contract.procedure

OpenCode keeps one skill per name, so the copy takes this folder's place. `litopencode extensions install visual-qa --yes` does it for you; `update` and `remove` work alike. By hand, clone https://github.com/wjgoarxiv/wjgoarxiv-skills once, then run the four lines. The first only lists same-name folders OpenCode reads; move any outside `~/.config/opencode/skills` out of the way (a project's `.opencode/`, `.agents/` and `.claude/` skills too). The second moves this folder whole into a dated backup, the third copies the extension in, the fourth writes its receipt.

```sh
ls -d ~/.config/opencode/skills/visual-qa ~/.agents/skills/visual-qa ~/.claude/skills/visual-qa 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/visual-qa ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/visual-qa "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/visual-qa" ~/.config/opencode/skills/visual-qa
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' visual-qa "<path to your wjgoarxiv-skills clone>/variants/litopencode/visual-qa" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/visual-qa/.litfamily-extension.json
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

Never run these lines or commands, or write into the OpenCode skills root yourself.

## #contract.anti_patterns

Making the deliverable another way as a stand-in, or saying the moved skill ran.
