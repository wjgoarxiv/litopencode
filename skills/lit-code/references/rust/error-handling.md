# Rust — errors

## Libraries: typed errors

```rust
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("record {0} not found")]
    NotFound(UserId),
    #[error("database unavailable")]
    Unavailable(#[from] sqlx::Error),
}
```

A caller can match on the variant and react. `#[from]` gives `?` conversion without boilerplate.
Never expose `anyhow::Error` from a library API — it erases exactly the information the caller needs.

## Binaries: contextual errors

```rust
use anyhow::{Context, Result};

let config = fs::read_to_string(&path)
    .with_context(|| format!("read config at {}", path.display()))?;
```

At the top level nobody matches on the error; they read it. `with_context` builds the chain that
makes the message useful, and the closure form avoids formatting on the success path.

## `unwrap` and `expect`

`unwrap()` in production code is a panic with no explanation. When a value genuinely cannot be
absent, `expect("...")` documents why — and the message should state the invariant, not the symptom:
`expect("config was validated at startup")`, not `expect("should exist")`.

In tests, `unwrap()` is fine.

## Panics are for broken invariants

A panic says "this program is wrong". Anything the caller could reasonably encounter — bad input, a
missing file, a network failure — is a `Result`. Panicking across an FFI boundary is undefined
behavior; catch it with `catch_unwind` there.

