# Python — exceptions

## Define a base exception per package

```python
class StorageError(Exception): ...
class RecordNotFound(StorageError): ...
class RecordConflict(StorageError): ...
```

One base lets a caller opt into "anything from this subsystem" without catching `Exception`. The
subclasses let it react to the specific case. Carry structured data as attributes rather than
formatting it into the message — callers should not parse strings.

## Chain, do not swallow

```python
try:
    payload = json.loads(raw)
except json.JSONDecodeError as exc:
    raise ConfigInvalid(f"config at {path} is not valid JSON") from exc
```

`raise ... from exc` keeps the original traceback. `raise ...` alone inside an `except` block also
chains implicitly, but stating it is clearer. Never `except: pass` — if a failure is genuinely
ignorable, catch the specific type and say why in a comment.

## Catch narrowly, near the cause

`except Exception` at a low level is the single biggest reason a Python traceback points somewhere
unrelated to the fault. Catch the exception you can actually handle, at the place where you can
handle it, and let everything else travel.

## The boundary rule

Libraries raise. Applications decide. Only the top-level entry point — `main`, a request handler, a
task runner — converts an exception into an exit code, an HTTP status, or a log line. Logging and
re-raising at every layer produces the same fault reported five times.

## Cleanup

`with` for anything with a lifetime; `contextlib.contextmanager` to write one in a few lines;
`try/finally` only when neither fits. `ExitStack` when the number of resources is dynamic.

