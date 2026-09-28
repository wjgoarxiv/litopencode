# Haskell — `haskell-language-server`

- **Server command:** `haskell-language-server-wrapper --lsp`
- **Extensions:** `.hs` `.lhs`
- **Requires:** GHC and Cabal or Stack

## Install

```bash
ghcup install hls
command -v haskell-language-server-wrapper
```

The `wrapper` binary is the right entry point: it selects the HLS build matching the project's GHC.

## Troubleshooting

- **GHC version mismatch is the dominant failure mode.** HLS must be built for the exact GHC the
  project uses. The wrapper exists to pick it; if the matching build is absent it will say so.
- **`hie.yaml`** may be needed for non-standard project layouts (`gen-hie` produces one).
- **First load is very slow** — it builds the project.

## Honest fallback while unserved

`cabal build` or `stack build`. The compiler is unusually informative in this language; the gap from
losing the server is smaller here than elsewhere.

