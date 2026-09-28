# Rust — making invalid states unrepresentable

Rust's type system is strong enough that most invariants can be structural rather than checked. That
is where the language pays for its difficulty; use it.

## Newtypes at every boundary

```rust
pub struct UserId(String);
pub struct Email(String);

impl Email {
    pub fn parse(raw: &str) -> Result<Self, InvalidEmail> { ... }
}
```

Validate once, in the constructor, and the rest of the program can stop re-checking. A function
taking `Email` cannot receive an unvalidated string, so the check cannot be forgotten.

## Enums instead of flag combinations

```rust
enum Connection {
    Disconnected,
    Connecting { started: Instant },
    Ready { session: SessionId },
}
```

Three booleans allow eight states, of which perhaps three are legal. An enum allows exactly the legal
ones, and the compiler enumerates them at every `match`.

## Typestate for ordering rules

When operations must happen in an order, encode the order in types: `Builder<Unvalidated>` →
`Builder<Validated>` → `build()`. A misordered call fails to compile instead of failing at run time.
Use this where the ordering is genuinely load-bearing; it costs readability, so it is not a default.

## Borrow rather than clone — but not religiously

Take `&str` and `&[T]` in parameters. Return owned values. Reach for `Cow<'_, str>` only when
profiling shows the clone matters. A `.clone()` that makes a lifetime problem disappear in
non-hot-path code is a reasonable trade, and fighting the borrow checker for a nanosecond is not.

`Rc`/`Arc` in a data model usually signals that ownership was never decided. Decide it.

