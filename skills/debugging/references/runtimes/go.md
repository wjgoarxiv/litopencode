# Go

## Get the real failure

```bash
go run -race ./cmd/app        # data races are silent until they are not
go test -race -run TestName ./pkg -v
GOTRACEBACK=all go run ./cmd/app
```

`-race` first, always. A Go bug that reproduces intermittently is a race until proven otherwise, and
the race detector names the two goroutines and the exact line.

## Inspect

```bash
dlv debug ./cmd/app
dlv attach <pid>
kill -QUIT <pid>              # full goroutine dump to stderr
```

The `SIGQUIT` dump is the single best tool for a deadlock: it prints every goroutine and what it is
blocked on, with no setup.

## The failures that waste the most time

- **Loop variable capture** in goroutines (fixed in Go 1.22+; still present in older modules).
- **A nil interface holding a nil pointer is not nil.** `err != nil` is true when `err` holds a typed
  nil. This produces "impossible" branches.
- **Unbuffered channel send with no receiver** blocks forever and looks like a hang, not an error.
- **`defer` in a loop** does not run until the function returns.

## Isolate

`go test -run '^TestName$' -count=1` — `-count=1` defeats the test cache, which otherwise reports a
pass for code you just changed.

