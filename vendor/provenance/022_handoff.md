# Lit Handoff provenance

The OpenCode adapter, distribution metadata, and authored source mirror in this package
are released under the MIT license in `vendor/licenses/022_handoff-MIT.txt`. MIT applies to
all four exact authored files under `vendor/handoff/`; their byte identity is recorded below.
The mirror was imported
byte-for-byte on 2026-07-18 from the four tracked files in `022_handoff` at source commit
`2fe2ca3` of `wjgoarxiv/my-agent-skills`. The mirror is deliberately isolated from the
adapter so host integration cannot silently rewrite the source contract.

| Exact mirror path | SHA-256 |
| --- | --- |
| `vendor/handoff/SKILL.md` | `e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6` |
| `vendor/handoff/evals/evals.json` | `0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da` |
| `vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md` | `43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3` |
| `vendor/handoff/templates/HANDOFF.md` | `2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd` |

Do not edit files under `vendor/handoff/` in place. Update the canonical source first, perform a
reviewed mechanical sync, and update all four recorded hashes in one change.
