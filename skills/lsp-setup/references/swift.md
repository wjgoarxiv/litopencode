# Swift — `sourcekit-lsp`

- **Server command:** `sourcekit-lsp`
- **Extensions:** `.swift` (also Objective-C/C++ in mixed targets)
- **Requires:** a Swift toolchain

## Install

Bundled with Xcode and with the swift.org toolchains — usually already present on macOS:

```bash
xcrun --find sourcekit-lsp || command -v sourcekit-lsp
```

On Linux, install a swift.org toolchain; the binary ships inside it.

## Troubleshooting

- **Nothing resolves in an Xcode project:** `sourcekit-lsp` targets Swift Package Manager. Xcode
  projects need a generated `compile_commands.json` or an SPM manifest to work well.
- **Mixed Objective-C targets** need the compilation database for the same reason `clangd` does.

## Honest fallback while unserved

`swift build`, or `xcodebuild` for Xcode projects.

