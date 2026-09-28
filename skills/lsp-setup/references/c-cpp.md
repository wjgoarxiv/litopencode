# C / C++ — `clangd`

- **Server command:** `clangd --background-index --clang-tidy`
- **Extensions:** `.c` `.cpp` `.cc` `.cxx` `.c++` `.h` `.hpp` `.hh` `.hxx` `.h++`
- **Requires:** LLVM/clang tooling

## Install

- macOS: `brew install llvm` (or the Xcode command line tools' bundled `clangd`)
- Debian/Ubuntu: `apt install clangd`
- Fedora: `dnf install clang-tools-extra`

```bash
command -v clangd
```

## Compilation database — the part that actually matters

`clangd` needs `compile_commands.json` to know each file's include paths and flags. Without it,
almost every include resolves to nothing and the diagnostics are noise.

```bash
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON   # CMake
bear -- make                                            # Make and friends
```

Point `clangd` at it with a `--compile-commands-dir=build` argument, or symlink the file to the
project root.

## Alternatives

- `ccls` — older, still capable, same compilation-database requirement.

## Troubleshooting

- **Headers report "file not found":** missing or stale `compile_commands.json`. Regenerate it.
- **Wrong standard applied:** set it in the build system so the database carries `-std=...`.

## Honest fallback while unserved

The build itself. `make`/`cmake --build` reports the real compile errors; it will not answer
cross-reference questions.

