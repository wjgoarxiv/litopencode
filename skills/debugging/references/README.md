# Debugging references

The skill body carries the method: capture, reproduce, read the real error, compete hypotheses,
predict then test, narrow, toggle, fix under test, clean up, receipt. These files carry the parts
that are runtime-specific or that only matter once the method has stalled.

| Read this | When |
|---|---|
| [runtimes/README.md](runtimes/README.md) | You need real runtime evidence and the language decides how to get it |
| [escalation.md](escalation.md) | Two hypothesis rounds have died and the next round would be a third guess |
| [tools.md](tools.md) | The failure is in a binary, a protocol, or a browser and normal instrumentation cannot see it |

Load one. These are inert notes: nothing here runs without the approval the skill body requires, and
a debugger attaching to a live process is a change to the user's machine even when it writes nothing.

