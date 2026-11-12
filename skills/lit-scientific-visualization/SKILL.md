---
name: lit-scientific-visualization
description: "Scientific Visualization moved to wjgoarxiv-skills (figures). This LitOpenCode pointer gives the OpenCode install lines and builds nothing."
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

# Scientific Visualization: now a LitFamily extension

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically; the commands below are for the user.

lit-scientific-visualization made publication-ready scientific figures from measured data, following the scientific-visualization source it adapted. It is now a LitFamily extension: LitOpenCode's core no longer ships it, and it lives in wjgoarxiv-skills, the LitFamily extension shelf, in the `figures` family, at these paths inside a clone of the shelf:

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
| Direct request | Asked for a figure: say it moved, give the four install lines, stop. Plot nothing and do not write a plotting script as a stand-in. |
| Inside a larger task | Inside a larger lit task: name the missing skill once, finish the parts that need no figure, and do not report a figure as made. |

## #contract.procedure

OpenCode keeps one skill per name, so the copy takes this folder's place. `litopencode extensions install lit-scientific-visualization --yes` does it for you; `update` and `remove` work alike. By hand, clone https://github.com/wjgoarxiv/wjgoarxiv-skills once, then run the four lines. The first only lists same-name folders OpenCode reads; move any outside `~/.config/opencode/skills` out of the way (a project's `.opencode/`, `.agents/` and `.claude/` skills too). The second moves this folder whole into a dated backup, the third copies the extension in, the fourth writes its receipt.

```sh
ls -d ~/.config/opencode/skills/lit-scientific-visualization ~/.agents/skills/lit-scientific-visualization ~/.claude/skills/lit-scientific-visualization 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/lit-scientific-visualization ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/lit-scientific-visualization "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-scientific-visualization" ~/.config/opencode/skills/lit-scientific-visualization
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' lit-scientific-visualization "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-scientific-visualization" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/lit-scientific-visualization/.litfamily-extension.json
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
