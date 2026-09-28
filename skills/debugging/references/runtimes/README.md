# Runtime evidence

The method is the same in every language; the way to *get* an observation is not. Read the one file
for the runtime in front of you.

| Runtime | File |
|---|---|
| Node / TypeScript | [node.md](node.md) |
| Python | [python.md](python.md) |
| Go | [go.md](go.md) |
| Rust | [rust.md](rust.md) |
| Compiled binary, no source | [native-binary.md](native-binary.md) |
| Bundled or minified JS shipped as a binary | [bundled-js-binary.md](bundled-js-binary.md) |

One rule holds across all of them: **runtime truth beats code reading.** A value printed at the
boundary where it was wrong outranks any amount of reasoning about what the code should have done.

