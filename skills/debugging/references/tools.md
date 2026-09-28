# Specialist tools

Reach for these only when ordinary instrumentation genuinely cannot see the failure. Each one is
heavier than it looks, and each one changes the user's machine or attaches to a live process — that
needs the same approval as any other change.

## Native debuggers — `gdb` / `lldb`

For a crash, a hang, or corruption in compiled code. The highest-value use is not stepping; it is a
backtrace from a core file, which costs one command and often ends the hunt.

```bash
ulimit -c unlimited          # allow core dumps in this shell
gdb --batch -ex bt -ex 'info registers' ./binary core
lldb --batch -o 'bt all' -o 'register read' -f ./binary -c core
```

Build with `-g` and without `-O2` before concluding a backtrace is unreadable. Optimised frames are
inlined away and the resulting trace is not evidence of anything.

`pwndbg` and `gef` are `gdb` plugins that add heap and register views. They are worth installing for
memory-corruption work and pointless otherwise.

## Sanitizers — cheaper than a debugger

For C, C++, Rust, and Go, a sanitizer run usually finds the cause faster than any interactive
session, because it reports at the moment of the violation rather than at the crash.

```bash
clang -fsanitize=address,undefined -g -O1 prog.c && ./a.out
go test -race ./...
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test    # or: cargo miri test
```

Run these before attaching a debugger. A clean sanitizer run is also real evidence.

## Static binary analysis — `ghidra`, `objdump`, `nm`

Only when source is unavailable. Start with the cheap tools: `nm -C`, `strings`, `objdump -d`, and
`ltrace`/`strace` (`dtruss` on macOS) will answer most questions about what a binary calls and when.
Ghidra's decompiler is for the cases those cannot reach; it is a large install and a long session.

Confirm you are permitted to analyse the binary before starting.

## Protocol and exploit work — `pwntools`

For byte-exact interaction with a process or socket when a shell cannot express it.

```python
from pwn import process, remote
io = process("./binary")          # or: remote(host, port)
io.sendline(b"payload")
print(io.recvall(timeout=2))
```

The library is authorization-sensitive by nature. Use it against systems you own or are engaged to
test, and say which applies.

## Browser failures — Playwright CLI

For a symptom only reproducible in a real page. The tracing mode is what makes it worth the setup:
it captures network, console, and DOM snapshots together, which is exactly the correlation a
screenshot loses.

```bash
npx playwright open --save-trace=trace.zip https://example.test
npx playwright show-trace trace.zip
```

Console output alone is not reproduction. A trace that shows the failing request next to the failing
render is.

