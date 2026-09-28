# Go — tooling

## Linting

`golangci-lint` with a small strict set beats a large permissive one. A useful baseline beyond the
defaults:

```yaml
linters:
  enable:
    - errcheck        # unchecked errors
    - govet
    - staticcheck
    - errorlint       # %v where %w belongs; comparison instead of errors.Is
    - bodyclose       # unclosed HTTP response bodies
    - rowserrcheck
    - contextcheck    # dropped or wrong context
    - nilerr          # returning nil after checking err != nil
```

`errorlint` and `nilerr` catch real defects rather than style; enable them before anything cosmetic.

## Modules

- Commit `go.sum`. It is the integrity record, not a lockfile artifact.
- `go mod tidy` before every commit that changed imports; a stale `go.mod` fails other people's
  builds and not yours.
- Pin the toolchain in `go.mod` (`go 1.23.0`) so behavior differences between contributors are
  visible rather than mysterious.

## Formatting

`gofmt` is not negotiable and needs no discussion. `gofumpt` adds a stricter superset — adopt it per
project, not per file, and never mix the two in one repository.

