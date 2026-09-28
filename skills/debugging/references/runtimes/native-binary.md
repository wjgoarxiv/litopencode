# Compiled binary without source

When the failing component is a binary you cannot rebuild, the loop is unchanged — reproduce,
observe, narrow — but every observation comes from outside the process.

## Watch what it does, before opening it

```bash
strace -f -e trace=file,network ./binary        # Linux
sudo dtruss -f ./binary                         # macOS
ltrace ./binary                                 # library calls
lsof -p <pid>                                   # what it currently holds open
```

Syscall tracing answers most questions — which config it actually read, which host it reached, where
it failed — in one command, and costs nothing.

## Then look inside

```bash
file ./binary && nm -C ./binary | head
strings -n 8 ./binary | grep -i <term>
objdump -d ./binary | less
```

`strings` finds error messages, paths, and version markers; matching the message you observed against
the binary's string table locates the code path without a decompiler.

## Crash

```bash
ulimit -c unlimited
gdb --batch -ex bt ./binary core
```

A stripped binary yields addresses rather than names. Check for a separate debug package or a
`.dSYM` before concluding the trace is useless.

## Boundaries

Confirm you are permitted to analyse and instrument the binary. Reverse engineering someone else's
shipped software may be constrained by licence or contract; that is a real limit, not a formality,
and it belongs in the report rather than being assumed away.

