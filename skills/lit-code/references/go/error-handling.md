# Go — errors

## Wrap with context, once per boundary

```go
if err != nil {
    return fmt.Errorf("load user %s: %w", id, err)
}
```

`%w` preserves the chain for `errors.Is` and `errors.As`. `%v` breaks it — that is the difference
between a caller being able to react and a caller having to match on strings.

Add context that the caller does not already have: which record, which file, which operation. Do not
restate the function name; the stack already implies it, and `open config: open config: no such file`
is what happens when every layer wraps without thinking.

## Sentinels for expected conditions

```go
var ErrNotFound = errors.New("not found")

if errors.Is(err, ErrNotFound) { ... }
```

For errors carrying data, define a type and use `errors.As`:

```go
type ValidationError struct { Field string; Reason string }
func (e *ValidationError) Error() string { return e.Field + ": " + e.Reason }
```

## The boundary rule

Libraries return errors. Programs decide what to do with them. Only `main`, an HTTP handler, or an
equivalent top-level boundary should log-and-continue or exit; everything below returns. Logging an
error *and* returning it produces the same failure reported several times, which is the commonest
noise source in Go services.

## Avoid

- **`panic` for expected failures.** Reserve it for programmer error — an impossible branch, a
  violated invariant established in the same package.
- **Discarding with `_`.** If it truly cannot fail, say why in a comment. Most `_ = f()` sites are
  unexamined.
- **`errors.New` inside a loop or hot path** where a sentinel would do; it allocates each time.

