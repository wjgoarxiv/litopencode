# Lua — `lua-language-server`

- **Server command:** `lua-language-server`
- **Extensions:** `.lua`

## Install

- macOS: `brew install lua-language-server`
- Otherwise: download the release and put the binary on `PATH`.

```bash
command -v lua-language-server
```

## Troubleshooting

- **Everything is "undefined global":** the server needs to know the runtime. A `.luarc.json` at the
  project root declares the Lua version and the globals the embedding host injects. Without it,
  embedded environments produce diagnostics that are entirely false.
- Library paths and disabled diagnostics also belong in `.luarc.json`, not in host routing.

## Honest fallback while unserved

`luacheck` if configured; otherwise `luac -p` for syntax only. Lua is dynamically typed — a clean
result here proves much less than in a typed language, and that should be said.

