## Problem and resulting behavior

Describe the concrete trigger and user-visible change. Link the relevant issue.

## Scope

Name affected OpenCode surfaces and any config, package, ownership, or migration
consequences. Explain new dependencies or permission changes if applicable.

## Validation

List exact commands and results, focused regression/negative cases, and any real
CLI/hook/isolated-install probes. Report failures, skips, and unverified host behavior.
Keep full private logs and local evidence out of the patch.

## Review checks

- [ ] The diff preserves unrelated files and user-owned configuration.
- [ ] Docs and managed payload/manifest changes agree with runtime behavior.
- [ ] Applicable native gates passed; remaining limits are explained above.
- [ ] Probe processes and disposable roots are cleaned up or explicitly accounted for.
- [ ] No secrets, project ledgers, local evidence, or tarballs are included.
- [ ] Version and release changes have separate explicit maintainer authorization.
