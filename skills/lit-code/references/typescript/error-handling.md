# TypeScript — failure at the boundary

`throw` accepts any value, and a caught value is `unknown`. Both facts shape how errors should be
handled.

## Narrow what you catch

```ts
try {
  await run();
} catch (err: unknown) {
  if (err instanceof ApiError) { ...; return; }
  throw err;
}
```

`catch (err)` gives `unknown` under `useUnknownInCatchVariables` (included in `strict`). Treat that
as a feature: it forces the narrowing that `err.message` would otherwise skip.

## Typed errors carry data

```ts
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
```

Setting `name` explicitly matters — subclass names are lost through some transpilation targets, and a
caller matching on it silently stops matching.

Use `cause` to chain: `new ConfigError("load failed", { cause: err })`.

## Result types where failure is expected

For an operation whose failure is ordinary — validation, parsing, a lookup that may miss — returning
a discriminated union puts the failure in the signature rather than out of band:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

Use exceptions for the unexpected. Using them for control flow makes every call site a potential
non-local exit, which is what makes async cleanup hard to reason about.

## Async

Every `Promise` needs an owner. A floating promise swallows its rejection and, in Node, can terminate
the process. Enable `@typescript-eslint/no-floating-promises` — it is the single highest-value lint
rule in this language. Use `void promise` to mark a deliberate fire-and-forget.

`Promise.allSettled` when partial failure is acceptable; `Promise.all` when it is not. Choosing
`all` by default turns one slow failure into a total one.

