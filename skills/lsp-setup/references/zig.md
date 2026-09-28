# Zig — `zls`

- **Server command:** `zls`
- **Extensions:** `.zig` `.zon`
- **Requires:** the Zig compiler

## Install

- macOS: `brew install zls`
- Otherwise: download the release matching your Zig version, or build from source.

```bash
zig version
command -v zls
```

## Troubleshooting

- **Version coupling is strict.** Zig's language and standard library still change between releases,
  and `zls` is built against a specific one. A mismatch produces confidently wrong diagnostics rather
  than a clean failure — check both versions before trusting any result.
- **Build-graph awareness is limited;** `zls` may not resolve modules declared only in `build.zig`.

## Honest fallback while unserved

`zig build` and `zig ast-check`. Given the version-coupling risk above, the compiler is the more
trustworthy signal whenever it disagrees with the server.

