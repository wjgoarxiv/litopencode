# Rust

## Get the real failure

```bash
RUST_BACKTRACE=full cargo run
cargo test -- --nocapture --test-threads=1
```

`--nocapture` matters: without it, `println!` from a passing-then-failing test is hidden, which is
usually where the evidence was.

## Sanitizers and Miri

```bash
cargo +nightly miri test                       # undefined behavior in unsafe code
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test --target <host-triple>
cargo test -- --test-threads=1                 # order-dependent state
```

For anything involving `unsafe`, Miri is the first move, not the last. It catches aliasing and
provenance violations that produce correct-looking behavior in debug and corruption in release.

## The failures that waste the most time

- **Debug and release differ.** Integer overflow panics in debug and wraps in release. A bug that
  only appears in `--release` is often this, or a UB issue the optimiser exposed.
- **`unwrap()` on a `Result` reports the panic site, not the origin.** Use `anyhow::Context` or
  `expect("what was being attempted")` so the message names the operation.
- **Trait resolution surprises:** a blanket impl or a deref chain selecting a different method than
  the one read. `cargo expand` shows what was actually generated.

## Isolate

`cargo test -p <crate> --lib <module>::` narrows to one module. If the failure disappears, the cause
is in the integration, not the unit.

