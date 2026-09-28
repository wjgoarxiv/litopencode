# Rust — `rust-analyzer`

- **Server command:** `rust-analyzer`
- **Extensions:** `.rs`
- **Requires:** a Rust toolchain

## Install

```bash
rustup component add rust-analyzer     # preferred: matches the active toolchain
command -v rust-analyzer
```

`brew install rust-analyzer` and the GitHub release binaries also work, but a standalone binary can
drift from the project's toolchain and then report phantom errors.

## Alternatives

None in practice. `rls` is retired.

## Troubleshooting

- **"failed to load workspace":** the root must contain `Cargo.toml`. For a workspace, open the
  workspace root, not a member crate.
- **Proc-macro or build-script errors:** these run real code; `rust-analyzer` may need
  `cargo check` to succeed first. Fix the build before blaming the server.
- **Huge projects feel dead on first open:** initial indexing is genuinely slow. Confirm it finished
  before concluding there is no coverage.

## Honest fallback while unserved

`cargo check --all-targets` and `cargo clippy`. Both are authoritative; neither is incremental
per-edit.

