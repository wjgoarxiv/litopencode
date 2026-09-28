# Python — async

## Structured concurrency by default

```python
async with asyncio.TaskGroup() as tg:      # 3.11+
    tg.create_task(fetch(a))
    tg.create_task(fetch(b))
```

The group waits for every child and cancels the rest when one fails. A bare `create_task` whose
handle is discarded is a leak: it can be garbage-collected mid-flight, and its exception surfaces as
a warning rather than an error. `anyio` provides the same guarantee across asyncio and trio.

## Never block the loop

A synchronous call inside a coroutine stops every other task. The commonest offenders are `requests`,
`time.sleep`, file reads, and CPU-bound work.

```python
await asyncio.to_thread(blocking_call, arg)          # I/O-bound
await loop.run_in_executor(process_pool, cpu_bound)  # CPU-bound
```

A "slow async service" is usually one blocking call away from being fast.

## Cancellation is an exception

`asyncio.CancelledError` propagates through your code. Two consequences:

- `except Exception` does not catch it in 3.8+ — that is deliberate, do not "fix" it.
- Cleanup in `finally` runs during cancellation, and an `await` there can be cancelled too. Use
  `asyncio.shield` only when the cleanup genuinely must complete.

## Timeouts at every external boundary

```python
async with asyncio.timeout(5):     # 3.11+
    result = await client.get(url)
```

No network call should be able to hang forever. A missing timeout is not visible in testing and is
the usual cause of a production stall.

## Avoid

- **Mixing sync and async versions of the same client** in one code path.
- **`asyncio.run` called more than once** in a process, or called from inside a running loop.
- **Sharing a connection pool across event loops.**

