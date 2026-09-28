# Go — testing

## Table tests, named cases

```go
tests := map[string]struct{
    in   string
    want int
    err  error
}{
    "empty":    {in: "", err: ErrEmpty},
    "one item": {in: "a", want: 1},
}
for name, tc := range tests {
    t.Run(name, func(t *testing.T) { ... })
}
```

A map keyed by description gives each failure a readable name and removes the temptation to index
cases by number. Randomised map order is a feature here: it surfaces order dependence.

## Test behavior, not implementation

Assert on what a caller can observe — the returned value, the error identity, the recorded side
effect. A test that reaches into unexported state has to change every time the implementation does,
which trains people to update tests without reading them.

## Fixtures

`t.TempDir()` and `t.Cleanup()` remove almost all manual teardown. `testdata/` is ignored by the
tool chain and is where golden files belong. For golden output, gate the rewrite behind a flag so
regenerating is deliberate:

```go
var update = flag.Bool("update", false, "rewrite golden files")
```

## What to run

```bash
go test ./... -race -count=1
go test -run '^TestName$' ./pkg -v
```

`-count=1` defeats the test cache. Without it, a "pass" can be a cached result for code you have
since edited — an observation that has misled more than one debugging session.

## Avoid

- **Asserting on error strings.** Compare with `errors.Is` / `errors.As`.
- **`time.Sleep` for synchronisation.** Use a channel, a `sync.WaitGroup`, or `require.Eventually`.
  Sleep-based tests are the main source of CI flakiness.
- **Mocking what you own.** Prefer a real in-memory implementation; mock only at a genuine external
  boundary.

