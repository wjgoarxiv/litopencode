# TypeScript — types that prevent defects

The type system is erased at run time. Everything below is about catching a mistake before it ships,
never about run-time behavior — and the boundary where external data enters is where that distinction
becomes load-bearing.

## Parse, do not assert

```ts
const Config = z.object({ port: z.number().int(), host: z.string() });
type Config = z.infer<typeof Config>;

const config = Config.parse(await readJson(path));   // throws on bad shape
```

`JSON.parse(...) as Config` is a lie the compiler believes. Validate at every boundary — network
responses, environment variables, files, message payloads — and let the type come *from* the
validator so the two cannot drift apart.

## Branded types for identifiers

```ts
type UserId = string & { readonly __brand: "UserId" };
```

Zero run-time cost; makes passing an `OrderId` where a `UserId` belongs a compile error.

## Discriminated unions over optional fields

```ts
type Result =
  | { status: "ok"; data: Payload }
  | { status: "error"; error: ApiError };
```

Optional fields allow states that cannot occur — `data` and `error` both present, or both absent. A
discriminated union allows exactly the real ones, and narrowing on `status` gives the compiler enough
to check every branch.

## Exhaustiveness

```ts
function assertNever(x: never): never {
  throw new Error(`unhandled: ${JSON.stringify(x)}`);
}
```

In the `default` branch of a `switch`, this turns "a new variant was added and one switch was missed"
from a run-time surprise into a compile error.

## Avoid

- **`any`.** It disables checking transitively. `unknown` forces a narrowing step, which is the
  point.
- **`as` outside a validated boundary.** Assertion is not verification.
- **`!` non-null assertion** where a check would do.
- **`enum`.** It emits run-time code and has surprising numeric behavior. `as const` objects or
  string literal unions do the job.
- **Interfaces mirroring the implementation.** Declare the type the consumer needs.

