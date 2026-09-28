# TypeScript / JavaScript — `typescript-language-server`

- **Server command:** `typescript-language-server --stdio`
- **Extensions:** `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.mts` `.cts`
- **Requires:** Node and npm

## Install

```bash
npm install -g typescript-language-server typescript
command -v typescript-language-server
```

Both packages are needed: the server is a thin protocol wrapper around `tsserver`, which ships in
`typescript`.

## Alternatives

- `vtsls` — a different wrapper over the same `tsserver`; closer to the editor extension's behavior.
- `deno lsp` — for Deno projects only. It will not resolve `node_modules`.

## Troubleshooting

- **Diagnostics stop at the file boundary:** the workspace root must contain `tsconfig.json`. Without
  it the server treats each file as isolated and cross-file errors vanish.
- **Monorepo resolves the wrong project:** open the package directory, or give the root a `tsconfig`
  with project references.
- **JS files report nothing:** type checking of plain JS requires `allowJs` plus `checkJs`, or
  `// @ts-check` per file.

## Honest fallback while unserved

`npx tsc --noEmit` gives the same type errors in bulk. It does not give per-edit feedback, and it
does not cover lint rules — run the project's linter separately and say which one.

