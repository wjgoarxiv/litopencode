# Status taxonomy

Every card carries one status word. The collector picks the first that applies, top to bottom.

| Word | Badge | Record that says so |
| --- | --- | --- |
| `waits-on-you` | `◆ WAITS ON YOU` | A `question` tool part still running or pending in the session, or the bounded run is `paused` with a pending boundary owned by the session. |
| `blocked` | `✕ BLOCKED` | The newest tool part ended in `error` and nothing has run for more than two minutes. |
| `paused` | `Ⅱ PAUSED` | The session's workflow stack holds a long discipline in the `paused` state. |
| `working` | `● WORKING` | The session is the one asking for the brief. |
| `done` | `✓ DONE` | The bounded start-work run is `completed`, owned by the session, and the session has not moved more than five seconds past the run's last update. |
| `idle` | `○ IDLE` | The session's `.litopencode/liveness` record says `idle` or `ended` and is at most five seconds older than the session's last stored move. |
| `working` | `● WORKING` | The session was updated within two minutes. |
| `done` | `✓ DONE` | A real count whose done equals its total. |
| `idle` | `○ IDLE` | None of the above. |

A `done` card never names a next step: what it left open is history. An `alive` liveness record changes nothing; the two-minute window still decides.

## Count sources, in order

1. The recorded stage count of a paused or active discipline in the stack (`lit-loop stage`).
2. The plan steps of the session's bounded start-work run (`plan steps of the run`).
3. The only open plan in the worktree (`plan steps`). Two open plans count for nobody.
4. The active goal's criteria (`goal criteria`).
5. The session's own todo list (`todo list`).
6. None: the card shows facts and, when running, the pulse.

## Facts

`steps` is the number of tool calls, `elapsed` the time between the first and the last update, `lanes` the number of child sessions, `last` the newest tool call as a verb and a file name (`Edit billing.ts`, `Run npm test`).

## Recommended-step precedence

Waiting, blocked, paused, another session still working, the running start-work run (this session only), the single open plan, this worktree's `HANDOFF.md` `Next` item, the newest idle session with a known next step. The next-step record is written only for `continue`, `work` and `plan`, and only when the step belongs to the asking session; a `HANDOFF.md` item writes no record at all.
