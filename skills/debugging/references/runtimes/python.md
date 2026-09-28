# Python

## Get the real traceback

```bash
python -X dev -X tracemalloc app.py
python -m faulthandler app.py     # dumps a trace on a segfault or hang
```

`-X dev` enables development mode: extra warnings, unclosed-resource reporting, and a stricter
allocator. It routinely surfaces the cause without any further work.

## Inspect

```bash
python -m pdb -c continue app.py       # drops to pdb at the exception
py-spy dump --pid <pid>                # stack of a live process, no restart
py-spy top --pid <pid>                 # where time is actually going
```

`py-spy` needs no cooperation from the target and is the fastest way to diagnose a hang.

## The failures that waste the most time

- **The wrong interpreter.** `python`, `python3`, the venv, and the tool's vendored runtime are four
  different environments. Print `sys.executable` and `sys.path` before believing an ImportError.
- **Shadowing.** A local file named `queue.py` or `types.py` silently replaces the stdlib module.
- **Mutable default arguments and class-level mutables** produce state that persists across calls in
  a way that reads as impossible.
- **`except Exception` upstream** is often why the error you see is not the error that happened.
  Search for bare handlers before trusting the message.

## Isolate

```bash
python -c 'import mod; print(mod.__file__); mod.thing()'
```

Import the module directly and call the failing function. Most "framework bug" reports do not
survive this.

