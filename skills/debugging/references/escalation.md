# Escalation — when two rounds have failed

The skill body says to stop after two rounds of investigation that produced no new observation. That
is where to stop *guessing*; it is not where to stop working. Continuing past two failures with the
same mental model is the single most reliable way to burn an afternoon, because the reason nothing
fits is usually that the cause sits in a category not yet imagined.

## The rule

**At two consecutive failed hypothesis rounds, stop investigating and reframe.** A third hypothesis
drawn from the same model is not a new hypothesis. Reframing means deliberately changing where you
are looking, not looking harder.

## Three reframes, run as separate passes

Do not blend these. The value comes from each being answered independently, because each one tends to
surface a different class of cause.

1. **Widen the boundary.** Assume the bug is not in the code being read. Environment, versions,
   build output that differs from source, a cached artifact, a second process, a different machine,
   the wrong file being executed entirely. Ask: *what would have to be true for this code to be
   correct and the symptom still real?*
2. **Invert the assumption.** Name the thing everyone has taken for granted — "the config is
   loaded", "the test runs the code I edited", "this function is called". Then prove it, with an
   observation, not by reading. Most stalled hunts contain exactly one such unexamined assumption.
3. **Follow the data, not the control flow.** Instead of tracing what runs, trace what the value
   *was* at each boundary it crossed. Corruption and identity bugs are almost invisible from the
   control-flow side and obvious from the data side.

## After reframing

A reframe that produces a new observation restarts the normal loop at "predict, then test". A
reframe that produces nothing on all three passes is a genuine stopping point: report what is known,
what was ruled out and how, and what evidence would be needed next. That report is a result. A third
speculative fix is not.

## Not for finished artifacts

This is for stuck root-cause hunts. When the task is producing something — an extraction, an audit, a
migration — and you want a skeptical check before calling it done, that is verification, not
escalation. Ask what would have to be false for the artifact to be wrong, and check those things
directly.

