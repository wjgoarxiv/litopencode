# Getting help

Start with the [README](README.md), [workflow reference](docs/reference.md), or
[Korean reference](docs/reference-Ko-KR.md). [Migration notes](docs/migration.md)
cover package and skill changes. For a reproducible bug, use this repository's bug
report template. For a proposed improvement, use its feature-request template.

Include the package version or commit, Node.js/npm and OpenCode versions, operating
system, exact command or route, expected result, and actual result. Mention whether
you used a global install, npm execution, or a local tarball, and whether the config
root is the default, XDG-based, or explicitly supplied. Replace identifying path
segments with placeholders consistently.

When the executable is already installed, a bounded diagnostic is:

```sh
litopencode doctor --json --no-auto-update
```

Inspect the output before sharing it. Attach the relevant redacted portion, not
your entire OpenCode configuration, provider credentials, session export, project
ledger, or home directory. Reproduce against a disposable config root when
possible, and say whether the failure occurs there too. See [Privacy](docs/privacy.md).

Model availability, provider billing and credentials, and host-specific UI behavior
also depend on OpenCode and your configured provider. Separate a local CLI or hook
result from an authenticated host-session result. Optional scientific Python
dependencies must be installed separately when the scientific workflow needs them;
a dependency diagnostic is not proof that a figure workflow completed.

Do not work around an ownership or permission refusal by deleting unfamiliar files
or granting the planner write access. Report the boundary and the smallest sanitized
reproduction. For vulnerabilities use [Security](SECURITY.md), and for conduct
concerns use the [Code of Conduct](CODE_OF_CONDUCT.md).

Support is community-based. There is no guaranteed response time or paid support
commitment in this repository.
