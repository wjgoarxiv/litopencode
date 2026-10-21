# Hand-off briefs

A brainstorm ends with a choice and a named next surface. It never starts that surface and never writes the work. This reference gives the two brief shapes and the rule for choosing between them.

## Which surface

| The chosen direction | Next surface | Why |
| --- | --- | --- |
| Has no acceptance criteria, no scope boundary, or several plausible readings | `deep-interview` | The next problem is deciding what exactly is meant. One decision at a time is the right tool. |
| Has a scope, a way to tell it is done, and an owner of the outcome | `lit-plan` | The next problem is ordering the steps. The planner writes the checklist and stops at the approval gate. |
| Is a doubted approach the user wants attacked before they commit | `lit-crucible` | The next problem is finding what will go wrong. This is not a brainstorm outcome unless the user asks for it. |
| Is only a list of ideas the user wanted to see | none | Say so and stop. Do not invent a next step. |

Tie-breaks:

- If you have to ask "what does done look like?" to write the plan, it is `deep-interview`.
- If you could write three ordered steps right now without guessing, it is `lit-plan`.
- If the user chose two and has not decided how they combine, ask that as the choice before handing off.
- If the user picked before the pool was wide, hand off anyway and say so.

## Brief for `deep-interview`

Use when the pick is still vague. The brief gives the interview a head start; it does not answer the interview's questions.

```
Chosen direction: <one sentence, the user's words where they gave them>
Why it was chosen: <the criteria it won on, and who chose it>
Runners-up and why they lost: <one line each>
Constraints that came out of the session: <only those the user stated or the repository proved>
Out of bounds: <as the user stated it>
Unanswered, surfaced by the pool: <questions the options raised and nobody resolved>
Pool width when chosen: wide | narrow (<why>)
```

The interview owns the questions. Do not turn the unanswered list into a list of assumptions, and do not fill in acceptance criteria that the user never gave.

## Brief for `lit-plan`

Use when the pick is concrete. The brief carries the decision and its trade-offs so the plan does not reopen the choice.

```
Chosen option: <one sentence>
Decided by: <the user, and the date or turn if known>
Trade-offs accepted: <what the user knowingly gave up, from the case against>
Constraints: <only those the user stated or the repository proved>
Non-goals: <what the discussion ruled out, as the user said it>
Runners-up kept in reserve: <one line each, so a blocked plan has a fallback>
Evidence the choice rests on: <files, commands, or facts checked; assumptions labelled as such>
```

The plan owns the steps, the order, and the verification. Do not write the checklist here and do not mark any step approved.

## Rules for both

- Say plainly which fields are decisions and which are recommendations. A recommendation never becomes a decision in the brief.
- Quote the user's words for the chosen direction when they gave them. A paraphrase silently narrows or widens scope.
- Carry the runners-up. A hand-off that lists only the winner makes a later reversal cost a whole new session.
- Name the next surface in one line: "Next: `deep-interview`, started with `/deep-interview`", or "Next: `lit-plan`, started with `/lit-plan`". The user starts it.
- If a session note exists, give its path and put the same brief in it under the hand-off heading.
- Do not claim the next surface has begun, and do not pre-answer what it will ask.

## When the user wants to build immediately

Some users say "great, do it". That is a request to implement, and this surface does not implement.

- If the direction is concrete, say that `lit-plan` is the next step, give the brief, and note that nothing runs until a plan is approved and `/start-work` is used.
- If the direction is vague, say that `deep-interview` comes first, give the brief, and keep it short.
- Never resolve the tension by starting to edit. The approval gates are the product.

## After the hand-off

The brainstorm is finished. If the next surface finds that the choice does not survive contact with the repository, it can send the user back here with a note on what failed; a second brainstorm starts from the first note and from the runners-up, not from nothing.
