# Elixir — `elixir-ls`

- **Server command:** `elixir-ls`
- **Extensions:** `.ex` `.exs`
- **Requires:** Elixir and Erlang/OTP

## Install

Download the ElixirLS release matching your OTP version and put the launcher on `PATH`, or build from
source with `mix elixir_ls.release`.

```bash
elixir --version
command -v elixir-ls
```

## Alternatives

- `lexical` and `next-ls` — newer servers, faster on large projects, less feature-complete.

## Troubleshooting

- **OTP mismatch is the usual failure.** ElixirLS releases are built per OTP/Elixir pair; a mismatch
  fails at startup rather than degrading quietly.
- **First run compiles the whole project** into its own build directory. It is slow once.

## Honest fallback while unserved

`mix compile --warnings-as-errors` and `mix dialyzer` if the project has Dialyxir set up.

