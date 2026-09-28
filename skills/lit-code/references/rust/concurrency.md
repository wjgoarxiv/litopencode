# Rust — concurrency

The compiler proves the absence of data races. It does not prove the absence of deadlocks, lost
wakeups, or logic that is simply wrong under interleaving.

## Send and Sync

`Send` means it can move to another thread; `Sync` means `&T` can be shared. Both are inferred. When
a type is not `Send`, the error names the offending field — usually an `Rc` or a raw pointer, and the
fix is usually `Arc`, not `unsafe impl Send`.

**Never write `unsafe impl Send`/`Sync` to make an error go away.** That assertion is the one the
compiler was making for you.

## Shared state

```rust
let counter = Arc::new(Mutex::new(0));
```

`Arc<Mutex<T>>` is the default and is usually right. `RwLock` only when reads genuinely dominate —
its bookkeeping costs more than a `Mutex` under contention. `parking_lot` is faster and has no
poisoning, at the cost of a dependency.

A `MutexGuard` held across an `.await` blocks the executor thread. Use `tokio::sync::Mutex` in async
code, or restructure so the lock is released before awaiting — the second is almost always better.

## Async

```rust
let (a, b) = tokio::try_join!(fetch(x), fetch(y))?;
tokio::select! { res = work() => ..., _ = shutdown.recv() => ... }
```

Spawned tasks need a `JoinHandle` that someone awaits, or they are fire-and-forget. `select!` drops
the losing futures at the branch point — a future cancelled mid-operation may leave state
half-written, so make each branch cancellation-safe or use `tokio::spawn` instead.

Never call blocking code in an async task: `spawn_blocking` for I/O, `rayon` for CPU work.

## Verify

`cargo test -- --test-threads=1` to expose order dependence, and `loom` for lock-free code — it
exhaustively explores interleavings that testing will never hit.

