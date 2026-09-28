---
name: Bug report
about: Report a reproducible LitOpenCode problem
title: ""
labels: ""
assignees: ""
---

<!-- For vulnerabilities, follow SECURITY.md. Do not post secrets or exploit details. -->

## Problem

What did you expect, and what happened instead?

## Environment

- Package version or commit:
- Node.js/npm and OpenCode versions:
- OS and terminal:
- Install method (local tarball, npm execution, or global):
- Config root type (default, XDG, or custom; redact private paths):
- Surface (install, doctor, command, chat hook, tool, skill, or ledger):

## Minimal reproduction

1. Start with synthetic files and a disposable config root if possible.
2. Record the exact command or OpenCode route and relevant options.
3. Describe the result and whether repeating it changes anything.

## Evidence

Provide relevant redacted output and actual exit codes. If using an installed CLI,
`litopencode doctor --json --no-auto-update` can help. Inspect its output first.
Do not attach full config files, provider credentials, sessions, or project ledgers.
Distinguish a local probe from an authenticated OpenCode session.

## Checks

- [ ] I checked the README/reference and existing issues.
- [ ] I removed secrets and private project content from the reproduction.
- [ ] I identified any skipped checks or optional dependencies.
