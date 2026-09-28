# Rust — `unsafe`

`unsafe` does not disable the borrow checker. It permits five specific operations: dereferencing a
raw pointer, calling an `unsafe` function, implementing an `unsafe` trait, mutating a `static mut`,
and accessing a union field. Everything else is checked as usual.

## The discipline

**Every `unsafe` block gets a `// SAFETY:` comment** stating the invariant that makes it sound, in
terms a reviewer can check:

```rust
// SAFETY: `idx < self.len` was checked above, and `self.ptr` is valid for
// `self.len` initialised elements for the lifetime of `&self`.
unsafe { &*self.ptr.add(idx) }
```

A block without one is not reviewable, and "it works" is not the invariant.

**Keep the block minimal.** Wrap the single operation, not the surrounding logic. A large `unsafe`
block hides which line carries the risk.

**Encapsulate behind a safe API.** The module exposing `unsafe` internals owns the proof. If a caller
can break the invariant through the safe interface, the interface is wrong — that is a soundness bug,
and it is a defect even when no current caller triggers it.

## The undefined behavior that actually bites

- **Aliasing `&mut`.** Two mutable references to the same location, even briefly, even unused.
- **Reading uninitialised memory.** Use `MaybeUninit`; a zeroed `bool` or reference is UB.
- **Invalid values.** A `bool` that is not 0 or 1, a `char` outside the Unicode range, a null
  reference — constructing one is UB immediately, before it is read.
- **Pointer provenance.** A pointer derived from one allocation cannot address another, even at a
  numerically correct address.
- **Unwinding across FFI.** Wrap in `catch_unwind`.

## Verify, do not assert

```bash
cargo +nightly miri test
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test --target <host-triple>
```

Miri catches aliasing and provenance violations that run correctly in debug and corrupt memory in
release. For anything with `unsafe`, run it before believing the tests. A clean release run proves
very little on its own.

