Choose the build lane from repository facts; its id and selecting facts set the contract's entry and exit checks.

## Choosing the lane

Select from observed repository facts, not request wording. Record the lane id with the two facts that chose it.

- No app, tokens, or routes exist yet: new-build.
- Working product, request adds or repairs a bounded surface: brownfield.
- Working product, request restyles the system across existing surfaces: redesign.
- A supplied image, page, or prose is declared a fidelity target: reference-fidelity.
- The deliverable is tokens or primitives other surfaces consume: design-system.

## New-build lane

Choose the smallest system that expresses the whole inventory.

- Gather: platform, stack, locales, minimum viewport, auth model, complete route list.
- May change: anything inside the new application boundary.
- Preserve: host repository conventions, lint rules, build configuration.
- Failure mode: inventing a component library and forty tokens to serve three screens.
- Exit: a hashed valid contract whose inventory the chosen primitives fully express.

## Brownfield lane

Make the new surface indistinguishable in system terms from what already shipped.

- Gather: current tokens and primitives, states of components you touch, dirty-worktree status, consumers of what you would modify.
- May change: the requested surface, plus additive tokens following existing naming.
- Preserve: token semantics, public props, keyboard order, route URLs, untouched copy.
- Failure mode: a second parallel design system diverging one commit at a time.
- Exit: nothing outside the requested scope renders differently.

## Redesign lane

Change how the product looks without changing what it does.

- Gather: baseline capture per affected route and state, a debt map by category, the owner of each behavior.
- May change: visual system, layout, hierarchy, density, spacing, motion.
- Preserve: every flow, permission, data contract, URL, and shortcut not listed for removal.
- Failure mode: reworking behavior under a visual change so regressions read as intent.
- Exit: the parity list holds and each intentional difference carries an exception id.

## Reference-fidelity lane

Rebuild the system the reference implies, not its pixels.

- Gather: reference hash, classification, per-trait comparison scope, traits it cannot show.
- May change: implementation matching observed structure, type scale, spacing, color roles.
- Preserve: real text as text, semantics, accessibility, your content, undepicted states.
- Failure mode: matching the image while shipping raster text and a short state inventory.
- Exit: paired comparison per declared trait, plus a fidelity report of inferred and unknown calls.

## Design-system lane

Treat the token and primitive surface as a published API.

- Gather: every consumer, the publication path, the states each primitive must express.
- May change: token values and primitive internals behind a stable name; new tokens.
- Preserve: token names and public props; deprecate with a migration note, never rename in place.
- Failure mode: shipping a breaking rename inside a release labeled polish.
- Exit: consumers render unchanged, or every intended break carries its migration step.

## When a request spans two lanes

Split it. A blended lane forfeits both sets of guarantees.

- Sequence design-system work first, then the lane that consumes it.
- Give each lane its own contract hash, inventory, and exit check.
- If only one can ship now, record the other as an omission id with its deferred scope.
- If the split is impossible, return blocked and name the decision the user owes you.

## Failure patterns

Reject a lane id without selecting facts, a greenfield rebuild of a working product, or a fidelity claim with open states. Do not duplicate token semantics or change lanes after implementation to excuse a deviation.
