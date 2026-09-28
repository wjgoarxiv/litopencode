# Contributing to LitOpenCode

LitOpenCode is an OpenCode plugin with its own CLI, command and skill payloads,
configuration, and project-local evidence state. Start with the [README](README.md)
and [workflow reference](docs/reference.md). Contributions are covered by the
[MIT license](LICENSE), whose holder is LitOpenCode contributors, and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before changing behavior

Open a focused issue for a reproducible bug or a concrete proposal. Describe the
OpenCode surface involved: installer, doctor, command, chat hook, tool, skill, or
project ledger. Use [Security](SECURITY.md) for vulnerabilities and
[Support](SUPPORT.md) for configuration questions. Remove secrets and private
project content from examples; see [Privacy](docs/privacy.md).

Read the repository's `AGENTS.md` when working with an agent. Keep changes inside
this product. Other family products are independent implementations, not shared
runtime dependencies. Preserve unrelated worktree changes and user-owned settings.
Do not edit the vendored corpus to alter product behavior.

## Local development

Use Node.js 22, matching CI, and npm with the committed lockfile:

```sh
npm ci
npm run build
node --test test/static-workflow-command.test.mjs
```

Choose the focused test for your change; the command above is an example for
command behavior. Tests use `node:test`. TypeScript relative imports must retain
their explicit `.ts` extensions. Reuse existing helpers and native hooks before
adding a new surface. Add a failing regression for changed behavior, including
unsafe or invalid input where applicable, then make the smallest sufficient fix.

Run these gates serially before requesting review:

```sh
npm test
npm run typecheck
npm run build
npm run scan:legacy-tokens
npm run check:version
npm run check:pack-payload
npm run check:managed-skill-manifest
```

`npm test` includes a build through its pretest hook. The pack guard also builds.
Do not run concurrent builds in one checkout. Redirect long output to a file and
record the command's actual exit code; piping into a final-line filter can hide
failure details. Preserve failed runs when reporting a later fix.

When managed skill files change, regenerate their manifest with
`npm run gen:managed-skill-manifest` and inspect the resulting diff. Do not update
hashes merely to conceal an unexpected payload difference. Native CLI, hook,
ownership, and installed-resource changes need an isolated real-surface probe as
well as unit tests. Use disposable HOME, OpenCode config, temporary, and npm cache
roots; never test installation against a contributor's live configuration.

CI also runs behavior replacement, installed-resource tamper, negative-gate,
rules-glob, and Wikify probes. Its evidence-ledger stress test remains a separate,
non-blocking diagnostic; report any failure without treating it as a pass. Optional
scientific Python dependencies can produce an explicit skip or degraded status;
record that limitation rather than claiming the scientific path was verified.

## Pull requests

Explain the user-visible problem, final behavior, affected surfaces, and validation.
Include meaningful negative cases and any remaining limits. Keep local evidence,
ledgers, credentials, temporary installs, and generated tarballs out of the diff.
Clean up owned probe processes and temporary roots after collecting evidence.

Preserve the planner's denied edit, shell, and delegation permissions. Keep native
registration IDs, ownership receipts, and config paths stable when changing npm
identity. A local package probe does not establish public availability or an
authenticated OpenCode session.

Versions and release actions are maintainer-controlled. A contribution or passing
CI does not authorize a version change, tag, remote update, or publication. Follow
the repository-only maintainer release checklist when separately authorized.
