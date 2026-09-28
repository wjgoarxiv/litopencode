# Bundled or minified JavaScript shipped as an executable

A single-file CLI produced by a bundler is the hardest common case: the stack points into generated
code, the line numbers are meaningless, and the source on disk is not what runs.

## Establish what is actually executing

```bash
head -c 200 ./cli            # shebang and banner
node -e 'console.log(require.resolve("<pkg>"))'
```

Confirm whether the running artifact is the local build, an installed global, or a cached copy. This
is the step most often skipped, and it invalidates everything downstream when it is wrong.

## Make the stack readable

```bash
NODE_OPTIONS="--enable-source-maps" ./cli <args>
```

If the bundle ships no source map, do not read the minified frame. Instead, locate the code by its
strings:

```bash
grep -o '.\{0,120\}<error message fragment>.\{0,120\}' ./cli
```

The surrounding characters usually identify the original function well enough to find it in source.

## Rebuild with the loop closed

The reliable move is to stop debugging the bundle. Rebuild from source with sourcemaps enabled, or
run the entry module directly with the runtime's TypeScript support, and reproduce there. If the
symptom disappears in that mode, the defect is in the bundling step — which is itself the finding.

## Watch for

- **A stale bundle.** Editing source and re-running the old artifact produces "impossible"
  observations. Check the mtime.
- **Bundler-injected polyfills or interop shims** changing `this`, default-export shape, or
  `import.meta`.
- **Tree-shaking removing a side-effecting import** that the source relied on.

