---
name: autoconference-skill
description: |
  Multi-agent research conference that spawns parallel autoresearchers with
  symposium sharing, adversarial peer review, and insight synthesis.
  Reads a conference.md, orchestrates N researchers in structured rounds,
  and produces a synthesized result combining the best findings.
  TRIGGER when: user mentions "autoconference" or "conference" with research context;
  user wants multiple researchers competing or collaborating; user wants parallel
  autoresearch with peer review; user mentions "conference.md"; user wants
  research synthesis from multiple approaches; user wants adversarial evaluation
  of research results.
  DO NOT TRIGGER when: user wants a single autoresearch loop (use autoresearch-skill);
  user wants a simple one-shot answer; user wants to read a single paper.
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Autoconference Source-Family Coverage

## OpenCode authority envelope

This reference is inert compatibility guidance. `lit-plan` must approve the finite root-owned
objective, budget, roots, packet schema, and review contract before any mutation or delegation,
including interactive runs. Only explicit `/start-work` may consume that approval. Children remain
depth-one and packet-only; children must not write or mutate root-owned state, select models, or
invoke routes.

This retained reference is inert coverage material. The installed `skills/autoconference/SKILL.md`,
read-only `lit-plan`, explicit `/start-work`, live root OpenCode task probe, and depth-one packet
contract are authoritative. Historical tool/model assumptions grant no capability.

## Mandatory Start Gate

Before dispatching `/autoconference`, require a pre-flight confirmation gate:

1. If the user has exactly specified researcher count, iterations/budget, Success Metric or Success Criteria, and Critic/Devil's Advocate inclusion, calculate the run conditions and produce an approval packet.
2. If any of those values are missing or vague, ask the user for exact values first; then calculate conditions and ask for final confirmation.
3. Do not write, evaluate, dispatch, or begin the conference loop from planning. After explicit
   confirmation, hand the packet to `/start-work`.

The adversarial Reviewer is part of the protocol every round; the gate's Critic/Devil's Advocate choice controls whether an additional researcher is assigned a contrarian role.

## Conference Persistence Directive

Once the bounded conference begins through `/start-work`:

1. Complete a round only while task capability, approved authority, and budget remain.
2. Stop on cancellation, stale state, a new boundary, malformed packets, or missing review.
3. Continue after a valid round receipt without seeking redundant approval inside the same grant.
4. **The conference runs until one of these conditions is met:**
   - Target metric achieved (convergence)
   - `max_rounds` or `max_total_iterations` exhausted (budget spent — this is normal, not failure)
   - All researchers simultaneously stalled at Level 2+ (early synthesis)
   - The user manually interrupts
5. **If none of these conditions are true, begin the next round immediately.**

Think of `max_rounds` as a budget to *spend*, not a limit to *fear*.

## Commands

| Command | Description | Skill Path |
|---------|-------------|------------|
| `/autoconference` | Core conference loop — N researchers, 4-phase rounds, synthesis | `skills/autoconference/SKILL.md` |
| `/autoconference-plan` | Planning-only proposal and approval packet | `skills/autoconference/modes/plan.md` |
| `/autoconference-resume` | Resume interrupted conference from checkpoint | `skills/autoconference/modes/resume.md` |
| `/autoconference-analyze` | Post-conference insight analysis | `skills/autoconference/modes/analyze.md` |
| `/autoconference-debate` | Adversarial 2-researcher debate mode | `skills/autoconference/modes/debate.md` |
| `/autoconference-survey` | Systematic multi-database literature survey | `skills/autoconference/modes/survey.md` |
| `/autoconference-ship` | Convert results to a local readiness packet | `skills/autoconference/modes/ship.md` |

## Dispatch Logic

- **Core command** (`/autoconference`) → load `skills/autoconference/SKILL.md` and `skills/autoconference/modes/core.md`.
- **Hyphen-native mode command** → load the exact enrolled `skills/autoconference/modes/<name>.md` contract.
- Unknown and near-miss modes remain inert; never fall back from a miss to an unintended execution route.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    CONFERENCE ROUND                       │
│                                                           │
│  Phase 1: INDEPENDENT RESEARCH (parallel)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │Researcher│ │Researcher│ │Researcher│  Each runs N     │
│  │    A     │ │    B     │ │    C     │  autoresearch    │
│  │ (iter×N) │ │ (iter×N) │ │ (iter×N) │  iterations     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                 │
│       │             │            │                        │
│  Phase 2: POSTER SESSION (packet-only comparison)         │
│  Phase 3: PEER REVIEW (independent review packet)         │
│  Phase 4: KNOWLEDGE TRANSFER (validated → shared)        │
└─────────────────────────────────────────────────────────┘
          │
          ▼  Convergence check → next round or final synthesis
```

## Agent Roles

| Role | Model | Count | Responsibility |
|------|-------|-------|----------------|
| **Root coordinator** | Current root-primary route | 1 | Owns capability probe, phase receipts, and terminal verdict |
| **Researcher** | OpenCode depth-one task | N | Runs bounded autoresearch within one partition and returns a packet |
| **Session Chair** | OpenCode depth-one task | 1/round | Produces the poster packet from accepted researcher packets |
| **Reviewer** | OpenCode depth-one task | 1/round | Challenges claims and returns verdict evidence |
| **Synthesizer** | Root or approved review task | 1 | Combines only independently validated findings |

## Dependencies

- **Required:** live root OpenCode task capability and the installed `autoresearch` managed family
- **Extends:** `skills/autoresearch/SKILL.md` — each researcher runs the bounded core loop
- **Python 3.8+** required only for `scripts/init_conference.py` (scaffolding helper)

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `autoresearch` | Required managed dependency for each researcher packet. |
| `lit-plan` | Read-only proposal and approval-packet route. |
| `/start-work` | Explicit bounded write/evaluator/task execution handoff after approval. |
| `/review-work` | Completed-work evidence review before a DoneClaim. |

## OpenCode Port Boundary

This file does not dispatch, write, or execute standalone. The package installer recursively installs
the family, and doctor verifies the exact tree. See `skills/autoconference/SKILL.md` and
`skills/autoconference/references/conference-protocol.md` for the current orchestration and isolation contracts.
