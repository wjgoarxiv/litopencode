# PHP — `intelephense`

- **Server command:** `intelephense --stdio`
- **Extensions:** `.php`
- **Requires:** Node and npm

## Install

```bash
npm install -g intelephense
command -v intelephense
```

Advanced analysis features are licensed; the free tier still provides diagnostics and navigation.

## Alternatives

- `phpactor` — fully open source.
- `psalm --language-server` or `phpstan` — static analysers with much stronger correctness checking;
  complementary to, not replacements for, the language server.

## Troubleshooting

- **Vendor symbols unresolved:** run `composer install`. Intelephense indexes `vendor/`.
- **Large project stalls on first open:** it is indexing; wait before concluding it is broken.

## Honest fallback while unserved

`php -l` for syntax only, plus `phpstan analyse` or `psalm` if the project has them configured.

