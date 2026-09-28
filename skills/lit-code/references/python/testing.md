# Python — testing

## Structure

```python
@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", None), ("a", 1)],
    ids=["empty", "single"],
)
def test_parse(raw, expected):
    assert parse(raw) == expected
```

`ids` gives each case a readable failure name. Parametrise over inputs; do not parametrise over
behavior — two genuinely different behaviors are two tests, and squeezing them into one parametrised
case with an `if` inside is how a test stops being readable.

## Fixtures

Prefer function scope. A `session`-scoped fixture holding mutable state creates order dependence,
which appears as a test that passes alone and fails in the suite. `tmp_path` and `monkeypatch` cover
most needs without custom teardown.

## Assert on behavior

Check the return value, the raised exception type, or the observable side effect. Reaching into
private attributes couples the test to the implementation and guarantees churn.

```python
with pytest.raises(RecordNotFound):
    store.get("missing")
```

Assert the exception *type*, not its message.

## Mock at the boundary only

Patch the external service, not your own function. `unittest.mock.patch` targets where a name is
looked up, not where it is defined — patching `mypkg.module.requests` rather than `requests` is the
correction for the commonest "the mock did nothing" symptom.

## Run

```bash
pytest -x -q                    # stop at first failure
pytest --lf                     # rerun last failures
pytest -p no:randomly           # rule out ordering when a failure looks flaky
```

