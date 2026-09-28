# Go — `gopls`

- **Server command:** `gopls`
- **Extensions:** `.go`
- **Requires:** the Go toolchain

## Install

`go install golang.org/x/tools/gopls@latest` on every platform; `brew install gopls` also works on
macOS. `go install` writes to `$(go env GOPATH)/bin` (default `~/go/bin`), which must be on `PATH`:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
command -v gopls
```

## Alternatives

None. `gopls` is the official and effectively sole Go language server.

## Troubleshooting

- **No diagnostics, or "no required module":** the workspace root must contain `go.mod`. Outside a
  module `gopls` degrades to a much weaker mode. Run `go mod tidy` if dependencies are unresolved.
- **Stale after a Go upgrade:** reinstall; `gopls` is built against a specific toolchain.
- **Analyses such as `staticcheck`** are `gopls` settings, not routing. They belong in the project's
  own tooling configuration.

## Honest fallback while unserved

`go build ./...` and `go vet ./...` cover compile and common correctness. Neither reports unused
imports the way the server does — say so when you substitute them.

