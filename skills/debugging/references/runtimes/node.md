# Node / TypeScript

## Get the real stack

```bash
node --stack-trace-limit=50 app.js
NODE_OPTIONS="--enable-source-maps" node dist/app.js
```

Without `--enable-source-maps` a TypeScript stack points into compiled output and the line numbers
are a different file. Fix that before theorising about a frame.

## Inspect a live process

```bash
node --inspect-brk app.js       # then attach; execution waits
kill -USR1 <pid>                # open the inspector on an already-running process
```

## The failures that waste the most time

- **Unhandled rejection swallows the trace.** `process.on("unhandledRejection", (e) => { throw e })`
  during a hunt turns a silent exit into a real error.
- **`async` frames are lost** unless the error was created in the async context. Create the `Error`
  early and attach context, rather than reconstructing at the boundary.
- **The file you edited is not the file that ran.** Stale `dist/`, a cached loader, or a package
  resolving to `node_modules` rather than the workspace source. Print `import.meta.url` or
  `require.resolve()` — do not assume.
- **`NODE_ENV` and conditional exports** can select a different bundle entirely.

## Cheap observations

```bash
node --trace-warnings app.js
node --cpu-prof app.js          # for a hang or a slowdown
node --heap-prof app.js
```

## Reproduce in isolation

`npm exec -- node -e '<snippet>'` with the module imported directly is usually enough to separate a
library defect from an integration defect. Do that before reading library source.

