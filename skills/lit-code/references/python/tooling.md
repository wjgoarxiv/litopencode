# Python — project configuration

Everything in `pyproject.toml`, so contributors, CI, and the editor read one source.

## Type checking

```toml
[tool.basedpyright]
typeCheckingMode = "strict"
venvPath = "."
venv = ".venv"
```

`venvPath`/`venv` matter more than the strictness setting: without them the checker resolves the
wrong interpreter and reports import errors for packages that are installed.

Adopting strict mode on an existing codebase works file by file. A repo-wide flip that produces
hundreds of errors gets suppressed wholesale, which is worse than not enabling it.

## Lint and format

```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "RUF", "ASYNC"]
```

`B` (bugbear) and `ASYNC` catch real defects — mutable defaults, blocking calls in async code. `I`
replaces isort. `ruff format` replaces black; do not run both.

## Dependencies

Pin with a lockfile (`uv.lock`, `poetry.lock`) and commit it. Declare ranges in `pyproject.toml`,
resolve exact versions in the lock. Separate dev dependencies from runtime ones so the deployed
image does not carry the test suite.

