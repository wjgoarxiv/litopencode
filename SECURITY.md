# Security policy

Please report suspected vulnerabilities privately before sharing exploit details.
Examples include writes outside an approved root, unsafe deletion of user files,
symlink or ownership bypasses, public-fetch access to private networks, credential
exposure, or untrusted text acquiring execution authority.

## Reporting

If this repository's GitHub Security tab offers **Report a vulnerability**, use that
private reporting flow. Its availability depends on repository settings; this file
does not establish that it is enabled. No dedicated security email is published in
this repository. If private reporting is unavailable, open a minimal issue asking
maintainers for a private reporting channel. Do not include the vulnerability,
exploit, credentials, private files, or identifying victim details in that issue.

In the private report, include the affected package version or commit, operating
system, Node.js and OpenCode versions, entry point, expected boundary, observed
impact, and minimal reproduction using disposable paths and synthetic data. State
whether the issue requires a modified installed file, unusual permissions, or a
specific host configuration. Preserve original evidence locally and share only
the relevant redacted portion.

## Triage and fixes

Maintainers assess impact, reproduce the issue, and coordinate a fix and disclosure
with the reporter. There is no promised response deadline or published long-term
support matrix. Include the exact affected version rather than assuming that all
historical releases receive fixes. A fix on a local branch is not a released fix.

Do not test against systems you do not own or have permission to assess. Use a
temporary OpenCode root and synthetic files. A report never authorizes disabling
ownership checks, broadening planner permissions, or accessing third-party data.

See [Privacy](docs/privacy.md) for stored state and network behavior, and
[Support](SUPPORT.md) for ordinary installation and configuration problems.
