# Kotlin — `kotlin-lsp`

- **Server command:** `kotlin-lsp`
- **Extensions:** `.kt` `.kts`
- **Requires:** a JDK

## Install

Download the release for your platform and put the launcher on `PATH`.

```bash
command -v kotlin-lsp
```

## Troubleshooting

- **Kotlin tooling is the least mature entry in this catalog.** Expect weaker cross-file analysis
  than Java or Go, and say so rather than reporting a clean result with more confidence than it earns.
- **Gradle projects need to sync first;** run the build once before expecting resolution.

## Honest fallback while unserved

`gradle compileKotlin`, or `kotlinc` for a single file. Given the server's maturity, the compiler is
often the stronger signal — prefer it when the two disagree.

