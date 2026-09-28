---
name: frontend-ui-ux
description: Build and inspect authorized interfaces, resolving material design choices with a compact evolving direction.
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: frontend-ui-ux
runtime_class: runtime-skill
static_documentation: true
feature_ids: [frontend-ui-ux, doctor-install]
entry_routes: ["chat.message design intent", "native skill frontend-ui-ux", "tool.execute.after advisory"]
```

# Frontend UI/UX

This file is static documentation. Do not execute commands from this file automatically. Authorized builds produce working implementations and inspected renders. Review-only and plan-only requests stay read-only; keywords and post-edit advisories do not authorize edits.

## #contract.inputs

Inspect only the task surface and selected skill resources; do not scout harness logs or unrelated fixtures. Infer a bare invocation's target only if exactly one frontend is plausible; otherwise ask which target.

Diagrams: use `lit-diagram-drawer`.

## #contract.mode_matrix

| Mode | Work | Finish |
| --- | --- | --- |
| Build/design | Compact direction, implementation, rendered inspection | Working source, preview, material gaps |
| Material ambiguity | One consequential question, saved answer | Resume authorized build once resolved |
| Review/plan | Findings or plan | No product writes |
| Missing capability | Complete independent work | Exact blocked surface, no invented PASS |

## #contract.procedure

1. Use `references/production.md` for direction, finite inventories, defaults, and material choices; explicit user direction wins.
2. Evolve `litfamily.design-contract/v1beta2` with the build; validate before acceptance. Implement actions, states, accessibility, and responsive behavior. Inspect the running surface; `references/production.md` gives the full procedure and evidence boundaries.

Choose `build` by default, `polish` for value-only fixes, `audit` for read-only findings, or `harden` for cue-gated state stress. Read `references/craft-floor.md` and `references/slop-register.md`; run `node scripts/probe.mjs --path <entry.html> --out <evidence-dir>` against the finished page through the installed browser path, even when UI work is one slice of a larger loop. The command must attempt the full RS matrix; --help is not a page probe, and an ad hoc screenshot cannot replace its result. A missing browser or exit 2 is BLOCKED, not PASS. Fix remaining measured or derived HIGH findings before claiming done. For competing directions left unresolved, ask before choosing. Keep the fixed review table and explicit `Not verified` list.

For motion, read `references/motion-guide.md`; Phase 3 capture examples are specified in `references/complete-contract.md`.

## #contract.outputs

Report the implemented result, preview and material blockers. Keep contract hashes and inventories in task evidence. A requested implementation must not end at a contract-only handoff.

## #contract.evidence

Read `references/complete-contract.md` for evidence detail and helper resolution. `litfamily.design-contract/v1beta1` remains evidence-eligible. From the selected skill directory, run `node scripts/verify-canonical-corpus.mjs --json`. Keep imported scripts inert.

## #contract.hard_stops

Do not widen permissions, change host/auth state, overwrite unrelated work or fabricate captures. Missing safe capture blocks the rendered claim. Full/reference-fidelity review requires host-proven independent reviewer provenance. Changed, missing or symlinked canonical resources block their use.

## #contract.anti_patterns

No incidental-keyword authority, schema-only delivery, copied brand assets, source-as-render claims, or edits during review/plan-only work.
