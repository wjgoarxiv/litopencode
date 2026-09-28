# Julia — `LanguageServer.jl`

- **Server command:** `julia --startup-file=no --history-file=no -e "using LanguageServer; runserver()"`
- **Extensions:** `.jl`
- **Requires:** Julia

## Install

```julia
julia -e 'using Pkg; Pkg.add("LanguageServer")'
```

There is no standalone binary — the server is a Julia package launched through the interpreter, which
is why the command is a `-e` invocation rather than an executable name.

## Troubleshooting

- **Startup is slow.** The server compiles on load; several seconds to a minute on first run is
  normal and is not a failure.
- **Project environment:** the server should run with the project's environment active or it will
  resolve the wrong package versions.
- **Diagnostics are shallow by design.** Julia's dispatch is resolved at runtime, so a clean result
  says considerably less than it would in a statically typed language. Say so.

## Honest fallback while unserved

The test suite (`julia -e 'using Pkg; Pkg.test()'`), plus `JET.jl` if the project uses it.

