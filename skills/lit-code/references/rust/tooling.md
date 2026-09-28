# Rust — tooling

## Lints

```toml
# Cargo.toml
[lints.rust]
unsafe_code = "deny"          # remove per-crate where unsafe is genuinely needed
missing_debug_implementations = "warn"

[lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "warn"
expect_used = "allow"
```

Declaring lints in `Cargo.toml` beats `#![deny(...)]` in `lib.rs`: it applies to the whole crate, is
visible where dependencies are, and does not need editing in a source file.

`clippy::pedantic` as a warning is productive. As `deny` it fights you over style during unrelated
work.

## Tests

- `insta` for snapshot tests — `cargo insta review` makes accepting a change deliberate.
- `proptest` where the input space is large and the invariant is simple. One property often replaces
  a dozen examples and finds the case nobody thought of.
- `criterion` for benchmarks. Do not infer performance from a `#[test]` with a timer.

## Build hygiene

- Commit `Cargo.lock` for binaries; for libraries it is advisory.
- `cargo deny check` for licence and advisory auditing in anything shipped.
- Pin the toolchain in `rust-toolchain.toml` so a nightly-only feature does not silently become a
  requirement for every contributor.

