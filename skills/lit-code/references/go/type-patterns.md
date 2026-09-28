# Go — modelling with types

Go's type system is deliberately small. The productive stance is to use it for the two things it does
well — distinguishing values that must not be confused, and making zero values usable — and to accept
that the rest is enforced by tests and review.

## Named types for units and identifiers

```go
type UserID string
type Cents  int64
```

The cost is a conversion at the boundary; the benefit is that passing an `OrderID` where a `UserID`
belongs stops compiling. Do this wherever two values of the same underlying type mean different
things. It is the highest-value type-level guard the language offers.

## Make the zero value useful

A struct whose zero value works needs no constructor and cannot be half-initialised:

```go
type Buffer struct { buf []byte }   // ready to use
```

When the zero value cannot be valid, do not export the struct — export a constructor returning an
interface or an opaque type, so an uninitialised instance is unconstructable rather than a runtime
surprise.

## Accept interfaces, return structs

Define the interface where it is *consumed*, listing only the methods that caller needs. A one- or
two-method interface declared next to its use is composable; a large interface declared next to its
implementation is a maintenance liability and forces fake-heavy tests.

```go
type userStore interface { ByID(context.Context, UserID) (User, error) }
```

## Avoid

- **`interface{}` / `any` in a domain signature.** It moves an error from compile time to run time
  and erases the documentation the signature was carrying.
- **Generics for a single concrete type.** Write the concrete version. Generalise on the second real
  caller, not in anticipation of one.
- **Embedding to fake inheritance.** Embedding promotes methods, including ones you did not intend to
  expose, and the promoted set changes when the embedded type changes.
- **Pointer receivers chosen at random.** Pick one form per type. Mixing them makes the method set
  differ between `T` and `*T`, which produces interface-satisfaction errors that read as nonsense.

