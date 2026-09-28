# Python — `basedpyright-langserver`

- **Server command:** `basedpyright-langserver --stdio`
- **Extensions:** `.py` `.pyi`
- **Requires:** Python and pip, or `uv`

## Install

```bash
pip install basedpyright        # or: uv tool install basedpyright
command -v basedpyright-langserver
```

## Alternatives

- `pyright-langserver --stdio` — the upstream project `basedpyright` forks; fewer strictness options.
- `pylsp` (python-lsp-server) — plugin-based, slower, but pure Python and easy to extend.
- `ruff server` — extremely fast, but a linter surface: it does not do type inference.

Prefer one type checker. Running `basedpyright` and `pyright` together produces duplicate diagnostics.

## Troubleshooting

- **Everything is `reportMissingImports`:** the server is resolving the wrong interpreter. Point it at
  the project's virtualenv (`venvPath` / `venv` in `pyrightconfig.json` or the `[tool.basedpyright]`
  table in `pyproject.toml`) — that is project configuration, not host routing.
- **Strictness disputes:** set them in `pyproject.toml` so every contributor and CI sees the same rules.

## Honest fallback while unserved

`python -m mypy .` or `ruff check .`, plus the test suite. A linter does not confirm a rename reached
every caller; name that gap.

