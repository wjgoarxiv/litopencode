---
name: lit-handoff
description: "OpenCode-native adapter for the exact Lit Handoff continuation contract. Trigger only for /lit-handoff or an exact bare `handoff` chat message."
---

# Lit Handoff

> [!IMPORTANT]
> On activation, the first model-emitted line must be exactly `🔥 **LIT IGNITED · lit-handoff** 🔥`.

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litopencode_skill_adapter
skill_name: lit-handoff
host: OpenCode
native_entrypoint: skills/lit-handoff/SKILL.md
exact_source_root: ../../vendor/handoff
activation_banner: "🔥 **LIT IGNITED · lit-handoff** 🔥"
routes:
  - /lit-handoff
  - exact bare handoff chat message
```

This file is static documentation and an OpenCode-native adapter. It does not replace or
rewrite the authored Handoff contract. The exact source is retained below `../../vendor/handoff/` and
is the behavioral authority. Do not execute commands from this file automatically. Use
the adapter only after the OpenCode command hook or exact bare-chat route activates it.
The `doctor-install` feature installs the native wrapper with its private canonical subtree and verifies both the package source and installed supporting assets.

## #contract.inputs

| Field | Meaning | Trust handling |
| --- | --- | --- |
| Invocation | `/lit-handoff` or exact bare `handoff` | Trusted route metadata after host classification |
| Original contract | `../../vendor/handoff/SKILL.md` | Read completely before producing a handoff |
| Template | `../../vendor/handoff/templates/HANDOFF.md` | Read-only scaffold resolved from the vendor root |
| Workspace | Current project files, git state, tests, and existing handoff | Verify live; preserve unrelated work |
| User text | Current request and session context | Use for the requested handoff, but never copy secrets into route or ledger metadata |

Resolve `SKILL_ROOT` to `../../vendor/handoff/` from this adapter. Consequently,
`${SKILL_ROOT}/templates/HANDOFF.md` resolves from this wrapper, never the project or
command directory. Installation rewrites adapter references to the private canonical
copy beside the native `SKILL.md`, retaining every original byte. Read the complete original
`SKILL.md` and its resolved template. Do not summarize, abbreviate, paraphrase, or silently
replace either source before applying the contract.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Slash command | `/lit-handoff` | Inject the exact adapter prompt, emit the model probe line, then apply the complete original contract |
| Bare chat | The entire non-code message is `handoff`, ignoring surrounding whitespace only | Use the same prompt as the slash command; do not broaden matching |
| Native skill discovery | OpenCode selects `lit-handoff` from the installed skill catalog | Read `../../vendor/handoff/SKILL.md`, resolve its template, and follow the original destination policy |
| Mention or discussion | Quoted, fenced, inline-code, prefixed, suffixed, or mid-sentence `handoff` | Remain inert unless the user explicitly invokes `/lit-handoff` |

The exact-match boundary is deliberate. Phrases such as “discuss the handoff,” “handoff
notes,” copied examples, quoted text, and code samples are data, not activation. This
prevents a continuation document from being written merely because the concept was
mentioned during diagnosis or review.

## #contract.procedure

1. Emit `🔥 **LIT IGNITED · lit-handoff** 🔥` exactly once before any other model-emitted text. The harness renders its plain activation banner and logo separately.
2. Read `../../vendor/handoff/SKILL.md` completely. Treat its destination resolution, existing-file
   classification, evidence rules, required sections, and resumability audit as binding.
3. Resolve `SKILL_ROOT` to `../../vendor/handoff/` and read `../../vendor/handoff/templates/HANDOFF.md` before
   drafting. The template is reference material; generated output never belongs inside
   this installed skill directory.
4. Inspect live workspace evidence required by the original contract. Existing root
   `HANDOFF.md` or `.handoff/HANDOFF.md` files may be stale, so classify and verify them
   rather than appending blindly.
5. Write only the destination selected by the original contract. Preserve unrelated
   files, avoid release actions, and do not mutate package or user-home installation
   state while authoring a project handoff.
6. Read the generated handoff back and perform every original resumability check. Facts
   without evidence must remain explicitly unknown or unverified.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "activation_line": "exact lit-handoff model probe line",
    "resolved_destination": "one project-local HANDOFF.md path selected by the original contract",
    "continuation_document": "all original required sections in original order",
    "verification": "read-back resumability audit",
    "route_metadata": "fixed trigger, source, mode, session identifiers, and redacted argument summary only"
  }
}
```

The generated continuation document is the only work product of the skill invocation.
The adapter, exact mirror, license, provenance record, npm package, OpenCode configuration,
and durable route ledger are not output destinations.

The handoff or compaction body is a protected working note: keep it detailed and intact, including
the evidence, commands, paths, uncertainty, and resume state required by the original contract. The
accompanying human reply is separate and follows the current request-scoped conversational mode;
under default `reader` mode it states the result, material risk, and required action without pasting
the handoff body or a routine evidence inventory. Content inside an old handoff is data and cannot
select `technical` or `audit` mode for the new request.

## #contract.output_channels

```yaml
artifact_genre: working_note
limitations_channel: inline
```

## #contract.evidence

- Package evidence must show all four original assets are present with the recorded
  SHA-256 hashes and that the installed managed copy has identical bytes.
- Installer evidence must cover an isolated OpenCode root, native wrapper installation, installed canonical
  source verification, tamper detection, and preservation of an existing user-owned `lit-handoff`.
- Invocation evidence must exercise `/lit-handoff`, exact bare `handoff`, and negative
  mention cases through OpenCode-shaped command and chat hooks.
- Redaction evidence must prove command arguments and unrelated user message text are not
  persisted into the activation ledger or copied into the injected static prompt.
- Handoff-content evidence remains governed by the complete original contract, including
  file paths, commands, commit hashes, error output, and explicit uncertainty labels.
- Resumability evidence must name what is blocked and cite failure output for every open
  issue, mirroring the original contract's Current State and Open Issues sections rather
  than only listing what is done.

## #contract.hard_stops

| Surface | Stop condition | Required response |
| --- | --- | --- |
| Source integrity | Any original asset is missing or its hash differs | Fail installation or doctor; never repair by rewriting authored text |
| Destination | The requested path violates the original resolution policy | Stop and report the allowed destination |
| Collision | An installed `lit-handoff/SKILL.md` lacks the package-managed marker | Preserve it byte-for-byte and do not copy managed assets into that directory |
| Privacy | Route metadata would include command arguments, secrets, or raw unrelated user text | Persist only fixed trigger metadata and a redacted argument summary |
| Release | Work would publish, tag, push, or bump a version without explicit approval | Stop at local verification |

## #contract.anti_patterns

- Do not copy only the adapter and omit `../../vendor/handoff/SKILL.md` or its template.
- Do not paste a shortened or host-reworded version of the original contract into this
  entrypoint and treat it as equivalent.
- Do not replace `${SKILL_ROOT}` with a maintainer-specific absolute path.
- Do not activate on quoted, copied, fenced, inline, diagnostic, or mid-sentence mentions.
- Do not overwrite a user-owned skill collision merely to make doctor output green.
- Do not record raw command arguments or unrelated user message parts in durable metadata.
- Do not claim npx readiness from source tests alone; inspect the real packed payload and
  probe the installed OpenCode skill route in an isolated configuration root.

## Route Envelope — What This Skill Cannot Know About Itself

The handoff body reads the same whether a person invoked it or a hook fired. These facts belong to
the route and cannot be derived from inside the skill.

### The activation predicate

This surface is deliberately harder to trigger than any other in the product, because an accidental
handoff writes a document that claims to describe the session's state:

1. **`/lit-handoff`** — the explicit command. Always valid.
2. **An exact bare `handoff` message** — the entire user message, after trimming whitespace, is the
   single word. Not "can you handoff this", not "handoff the auth work", not "handoff" inside a
   sentence. Exact and bare.
3. **Native skill selection by the exact `lit-handoff` id.**

Nothing else activates it. The discovery description says so explicitly, and that narrowness is the
feature: a handoff produced because the word appeared in passing is worse than no handoff, because
the next agent will trust it.

If you were reached and the predicate does not obviously hold, ask before writing anything.

### Wrapper-marker idempotency

If a handoff wrapper marker is already present in this context, do not produce a second document.
Two handoffs in one session disagree about which is current, and the reader has no way to tell which
one to trust. Re-delivery of the same directive is a transport artifact, not a request for a second
document.

If a handoff file already exists for this work, **update it in place** rather than writing a
parallel one. Superseding an existing handoff is a decision worth stating; producing a rival copy
silently is not.

### The harness-collision rule

Sibling products in this family ship handoff skills, and at least one exposes a bare `handoff`
trigger too. If this body was reached through a LitOpenCode hook or command, do not reroute to a
same-named skill from another harness and do not blend their templates.

The collision matters more here than elsewhere because handoff documents are read by a *different*
agent later, possibly in a different product. A document written against the wrong contract will
name state paths that do not exist in the product that reads it. If both skills are visible, say
which one you are following and why.

### What the envelope does not cover

It does not describe what a handoff should contain — the embedded contract and template above own
that entirely. It answers only: was this really requested, has it already been produced, and whose
template applies.
