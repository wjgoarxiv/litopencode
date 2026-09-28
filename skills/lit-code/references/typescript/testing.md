# TypeScript — testing

## Structure

```ts
describe("parseConfig", () => {
  it.each([
    ["empty input", "", null],
    ["valid port", '{"port":8080}', 8080],
  ])("%s", (_name, raw, expected) => {
    expect(parseConfig(raw)?.port ?? null).toBe(expected);
  });
});
```

Name the case, not the index. A failure that reads `parseConfig > case 3` costs a lookup every time.

## Assert on behavior

Check the returned value, the thrown error type, or the observable effect. Testing that a private
method was called couples the test to the implementation and produces churn on every refactor.

```ts
await expect(store.get("missing")).rejects.toThrow(RecordNotFound);
```

Assert the error type, not the message.

## Mock at the boundary

Mock the HTTP client, the clock, the filesystem — the things you do not own. Mocking your own modules
means the test verifies the mock. For HTTP specifically, an interceptor such as `msw` or `nock`
exercises the real client code path, which a stubbed module does not.

Fake timers for anything time-dependent; a test with a real `setTimeout` is a slow test and
eventually a flaky one.

## Types are not tests

A passing type check proves the shapes line up, not that the logic is right. Conversely, a test that
only asserts a type (`expectTypeOf`) belongs in a type-level test file, separate from behavior tests.

