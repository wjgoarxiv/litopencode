# Go — concurrency

## Every goroutine needs an owner and an exit

Before starting one, answer: who waits for it, and what makes it stop? A goroutine with no answer to
either is a leak, and leaks in Go are silent — the process keeps running with a growing set of
blocked stacks.

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return worker(ctx) })
if err := g.Wait(); err != nil { ... }
```

`errgroup` answers both questions in one construct: it waits, and it cancels the context when any
member fails. Prefer it to a bare `sync.WaitGroup` whenever the workers can fail.

## Context is the cancellation channel

Pass `ctx` as the first parameter, honour it in every blocking operation, and never store it in a
struct. A worker that ignores `ctx.Done()` cannot be shut down, and that surfaces as a hang at
deployment rather than in tests.

## Channels versus mutexes

Use a channel to transfer ownership of a value. Use a mutex to protect a field. Most "channel
architecture" that becomes unreadable is a mutex problem being solved with channels.

Keep the critical section small and never call out to unknown code — a callback invoked while holding
a lock is how a deadlock is written by accident.

## The races that survive review

- **Loop variable capture** in goroutines. Fixed in Go 1.22+; still live in older modules.
- **Unbuffered send with no receiver** blocks forever; it reads as a hang, not an error.
- **A `nil` interface holding a typed `nil` pointer is not `nil`.** The `err != nil` branch runs.
- **`defer` inside a loop** does not release until the function returns.
- **Map access from two goroutines** is a race even when only one writes, and it crashes the process
  rather than corrupting quietly.

`go test -race` is not optional for concurrent code. Run it in CI, not just locally.

