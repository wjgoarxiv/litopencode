# Python — types that carry weight

Annotations are checked by a separate tool, never at run time. That makes some patterns genuinely
valuable and others decorative.

## Worth doing

**Annotate every public signature.** Parameters and return type. Internal helpers can stay bare when
the types are obvious from two lines of context; a module boundary should not.

**`NewType` for identifiers.** Free at run time, and it stops the argument-order mistake that unit
tests rarely catch:

```python
from typing import NewType
UserId = NewType("UserId", str)
OrderId = NewType("OrderId", str)
```

**Narrow the container types.** `Sequence[str]` in a parameter accepts more callers than `list[str]`
and promises less; `list[str]` in a return type promises more than `Iterable[str]` and lets the
caller index. Pick per direction, not per habit.

**Model absent and invalid separately.** `str | None` says "may be missing". A `Result`-style union
or a raised exception says "may be wrong". Collapsing the two into `None` is how a validation failure
becomes a `NoneType` error three frames away.

**`Literal` and `Enum` for closed sets.** `Literal["read", "write"]` costs nothing and turns a typo
into a type error.

## Where it stops helping

- **`Any` anywhere in a domain signature** disables checking for everything downstream of it, silently.
- **`cast()` as a way to quiet the checker.** It asserts something the checker could not verify. Each
  use should be justified in a comment or replaced with a runtime check.
- **Deep generic gymnastics.** If the annotation is harder to read than the function, the function is
  probably doing two things.
- **`# type: ignore` without a code.** Use `# type: ignore[arg-type]` so the suppression stops
  applying when the reason changes.

## Dataclasses

`@dataclass(frozen=True, slots=True)` for value objects: immutability prevents a whole class of
aliasing bug, and `slots` removes the per-instance dict. Use `field(default_factory=list)` — a bare
mutable default is shared across every instance, which is the oldest trap in the language.

