# Ruby — `rubocop --lsp`

- **Server command:** `rubocop --lsp`
- **Extensions:** `.rb` `.rake` `.gemspec` `.ru`
- **Requires:** Ruby and Bundler

## Install

```bash
gem install rubocop           # or add to the Gemfile and run: bundle install
command -v rubocop
```

Run it through `bundle exec` when the project pins a version, so the server and CI apply the same
cop set.

## Alternatives

- `ruby-lsp` — richer navigation and completion; pair it with RuboCop rather than replacing it.
- `solargraph` — older, type-inference oriented.

## Troubleshooting

- **Ruby has no type checker in this position.** RuboCop reports style and a useful subset of
  correctness cops; it will not find a type error, because the language does not expose one. State
  that limit when reporting a clean result.
- **Cop disputes belong in `.rubocop.yml`,** which is version-controlled and shared — not in host
  routing.

## Honest fallback while unserved

The test suite. In Ruby it carries proportionally more of the verification burden than in typed
languages.

