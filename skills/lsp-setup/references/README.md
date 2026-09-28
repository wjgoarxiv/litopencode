# Language server catalog

The skill body decides *whether* to acquire a capability and *how* to propose it. This catalog
answers the one factual question that decision needs: **which server serves this extension, and what
does installing it cost the user.**

Read one file — the one matching the unserved extension. These are inert package notes, not
instructions to execute: nothing here is run without the approval the skill body requires.

| Extension(s) | Server | Reference |
|---|---|---|
| `.sh` `.bash` `.zsh` `.ksh` | `bash-language-server` | [bash.md](bash.md) |
| `.c` `.cpp` `.cc` `.cxx` `.h` `.hpp` `.hh` | `clangd` | [c-cpp.md](c-cpp.md) |
| `.cs` | `csharp-ls` | [csharp.md](csharp.md) |
| `.dart` | `dart language-server` | [dart.md](dart.md) |
| `.ex` `.exs` | `elixir-ls` | [elixir.md](elixir.md) |
| `.go` | `gopls` | [go.md](go.md) |
| `.hs` `.lhs` | `haskell-language-server` | [haskell.md](haskell.md) |
| `.java` | `jdtls` | [java.md](java.md) |
| `.jl` | `LanguageServer.jl` | [julia.md](julia.md) |
| `.kt` `.kts` | `kotlin-lsp` | [kotlin.md](kotlin.md) |
| `.lua` | `lua-language-server` | [lua.md](lua.md) |
| `.php` | `intelephense` | [php.md](php.md) |
| `.py` `.pyi` | `basedpyright-langserver` | [python.md](python.md) |
| `.rb` `.rake` `.gemspec` `.ru` | `rubocop --lsp` | [ruby.md](ruby.md) |
| `.rs` | `rust-analyzer` | [rust.md](rust.md) |
| `.swift` | `sourcekit-lsp` | [swift.md](swift.md) |
| `.tf` `.tfvars` | `terraform-ls` | [terraform.md](terraform.md) |
| `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | `typescript-language-server` | [typescript.md](typescript.md) |
| `.yaml` `.yml` | `yaml-language-server` | [yaml.md](yaml.md) |
| `.zig` `.zon` | `zls` | [zig.md](zig.md) |

An extension absent from this table is not a gap in the user's setup — it is a gap in this catalog.
Say which it is. Do not guess a server name; a proposal to install something that does not serve the
file is worse than reporting no coverage.

Every entry declares the same four things, because those are what a proposal needs to be honest:
the server, the extensions it actually serves, what installing it pulls in, and how to tell whether
it is already there. Behavior configuration — rule sets, strictness, excluded paths — stays in the
project's own config for that tool, never in the host routing declaration.
