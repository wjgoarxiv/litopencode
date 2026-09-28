---
name: visual-qa
description: Use a concise OpenCode-native evidence gate for rendered surfaces, with exact blocked outcomes and lazy detailed references.
---

## #contract.activation

```yaml
contract_schema_version: litopencode.skill_contract.v1
skill_id: visual-qa
runtime_class: runtime-skill
static_documentation: true
feature_ids: [visual-qa, doctor-install]
entry_routes: ["chat.message visual-qa", "native skill visual-qa", "tool.execute.after advisory"]
```

# Visual QA

This is static documentation for the native-installed LitOpenCode validator. Do not execute commands from this file automatically. It is not a browser executor, does not make a browser callable, and grants no capture authority.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| target | Exact surface, state, viewport, interaction, and binary observable |
| artifacts | Bounded captures with an evidence-eligible beta design hash, source/capture hashes, and freshness |
| reviewer | Host-proven independent identity when the tier requires review |

## #contract.mode_matrix

| Mode | Evidence | Outcome |
| --- | --- | --- |
| smoke | Critical inventory and one real channel | PASS, FAIL, or BLOCKED |
| full | Complete inventory plus independent review | PASS only with material evidence |
| reference-fidelity | Full evidence plus reference targets | Semantic and visual checks must pass |

## #contract.procedure

1. Probe callable current-session capability before promising capture.
2. Use only an existing project or host executor; define the observable before running it.
3. Accept only caller-authorized open material descriptors; read, recheck, and close each. Validate bytes, hashes, pointers, source freshness, passing required channels, findings, and cleanup.
4. Reconcile the frozen contract source hash and review policy. Require host-proven independent review over immutable inputs whenever the contract says so; self-attestation cannot establish provenance.
5. Return the highest-precedence honest verdict. BLOCKED outranks FAIL and cannot become PASS by prose.

## #contract.outputs

Return PASS with paths and hashes, FAIL with findings, or an exact BLOCKED receipt. Only `litfamily.evidence-manifest/v1beta1` bound to the caller's exact open-descriptor set is eligible. A root path alone blocks: Node lacks portable `openat`, so containment cannot be proved across root swap/restore. Nested labels block; v1alpha1 is diagnostic only. Full and reference-fidelity remain blocked without host-owned reviewer provenance.

## #contract.evidence

Require the canonical `litfamily.design-contract/v1beta2` Design Contract. Valid `litfamily.design-contract/v1beta1` documents remain accepted and evidence-eligible. Validate material evidence with `schemas/evidence-manifest-v1beta1.json`; alpha is migration-only and cannot PASS evidence. Read `references/capture-playbook.md` for channel capture and `references/complete-contract.md` only for detailed schemas, tiers, commands, reviewer rules, and failures.

## #contract.hard_stops

- No browser install, network authority, MCP route, authentication persistence, host-config mutation, or write authority.
- A path, HTTP response, similarity score, or same-context assertion is not material visual evidence.
- Missing renderer, safe authentication, reviewer provenance, timeout, or cleanup is BLOCKED.

## #contract.anti_patterns

Reject nonexistent, non-image, stale, self-attested, root-escaping, or symlink evidence; reject browser criteria downgraded to non-browser surfaces.
