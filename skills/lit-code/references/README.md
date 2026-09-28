# Language references

The skill body carries the doctrine: minimum first, smallest correct change, test the behavior not
the implementation, keep the diff traceable to the request. These files carry what changes per
language — the idioms that are actually load-bearing, the strictness settings worth turning on, and
the mistakes that survive review because they look idiomatic.

| Language | Files |
|---|---|
| Go | [go/](go/README.md) |
| Python | [python/](python/README.md) |
| Rust | [rust/](rust/README.md) |
| TypeScript | [typescript/](typescript/README.md) |

Read the one file you need. These are opinionated defaults for new code, not rules to impose on an
existing codebase: matching the surrounding code outranks every recommendation here. When a project
has already chosen differently and consistently, follow the project.

