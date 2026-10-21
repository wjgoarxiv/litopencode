# Scoring and convergence

Convergence is the second half of a brainstorm and a different act from the first. Divergence asks "what else?"; convergence asks "which of these, and what does choosing it cost?". Do not start it until the pool is wide, and do not let it hide how the pool was cut.

## 1. Fix the criteria first

Criteria are the yardsticks. Choose them before scoring, show them, and let the user change them. Changing them after the scores are visible is the single most common way a brainstorm gets steered without anyone noticing.

- Three to five criteria. Fewer than three gives no trade-off to discuss; more than five dilutes every one.
- Take the user's own words when they gave any ("easy to say aloud", "we can try it this week").
- When the user gave none, propose them in one line and mark them as proposals. Derive them from the question: what would a good answer be good at, and what would make an answer unusable?
- Include at least one criterion about cost or risk, not only benefit. A pool scored only on appeal always elects the most appealing option.
- Include a "fits what we already have" criterion for project questions.
- Write each criterion so that high is good. "Low effort" is a high-is-good criterion; "effort" is not.

## 2. Cluster and dedupe

Before scoring, shrink the pool to distinct ideas.

1. Read the pool once and group options that are the same idea. Test: would choosing one rule out the other, or would they be built, funded or explained differently? If not, they are one cluster.
2. Keep the best wording of each cluster. Record in one line what was merged ("three naming variants of a river metaphor").
3. Drop clusters that add nothing over the plain default. Say that they were dropped and why.
4. Keep any cluster that the user is unlikely to have thought of, even if it will score badly. It informs the discussion.
5. Expect fifteen to twenty raw options to become six to ten clusters.

## 3. Score coarsely

Use a three-level scale per criterion: low, medium, high. Fine numeric scores imply a precision nobody has and invite arguments about the second decimal instead of the trade-off.

| Cluster | Criterion A | Criterion B | Criterion C | Note |
| --- | --- | --- | --- | --- |
| Option one | high | medium | low | The cheap option, but it forces a later migration. |
| Option two | medium | high | medium | Closest to what exists today. |
| Option three | low | high | high | Interesting, and the least proven. |

- Score each cluster against each criterion separately, and write a note when a score rests on a guess.
- An unscored cell is allowed and should read "unknown", with what would settle it.
- Do not add the columns up. A total hides the very trade-off the user needs to see. If the user wants a ranking, rank by the criterion they say matters most and show the others beside it.

## 4. Look for dominance and close calls

- **Dominance:** if cluster X is at least as good as cluster Y on every criterion and better on one, drop Y from the short list and say so.
- **Close call:** if two clusters trade places depending on which criterion matters more, keep both and name the trade-off as the choice. This is the user's decision, not a tie to break quietly.
- **Single leader:** if one cluster leads on every criterion that matters, say so, and then try to break it. Ask what would have to be true for it to be wrong and write that sentence beside it.
- **No leader:** if nothing scores well, the pool is weak or the criteria are in conflict. Say that, and offer another divergence round with a lens that was not used or a reframe of the question.

## 5. Build the short list

Three to five survivors. The count follows the pool, not a quota: two real survivors is better than five padded ones, and in that case say that the pool narrowed fast and offer to reopen it.

Each survivor is written the same way so the user can compare them:

```
### <name or one-line label>
What it is: <one sentence a stranger could repeat>
Why it ranked: <the criteria it won on, with the scores>
What it costs: <time, risk, a dependency, a decision it forces later>
The case against it: <the strongest fair objection>
```

- The case against is written as its best advocate would write it, not as a strawman.
- Cost is concrete: "needs a second account", "changes the public name", "two weeks", not "some effort".
- Keep each survivor to the same length so the longest does not win by volume.

## 6. Recommend without deciding

After the list, give one recommendation and the reason in a sentence or two. Mark it as a recommendation. Say what would change it. A recommendation is useful because it shows how the options look to an evaluator; it is harmful when it is dressed as the result.

If two survivors combine into something stronger, offer the combination as an explicit fourth option, with what each parent contributes.

## 7. Ask for the choice

One question, three kinds of answer: pick one, combine two, reopen the pool. Use OpenCode's `question` tool when the session lists it, with each survivor as an option and a reopen option; otherwise number the options in plain chat.

- Do not ask the user to rank all the criteria. If the real disagreement is which criterion matters, state it and make that the question.
- Do not ask "should I proceed?". It presupposes a chosen thing.
- If the answer is a new constraint, reframe and re-run convergence over the existing pool before generating anything new.
- If the user picks quickly, accept it. Record whether the pool was wide when they picked.

## 8. Mistakes to avoid

- Scoring before the criteria are agreed.
- Letting a favoured option write its own criteria.
- A short list of one presented as a short list.
- A short list of seven, which is a second pool.
- Totals that turn a trade-off into a number.
- Rewriting the criteria after seeing who won.
- Dropping the plain default from the comparison, so every clever option looks good.
- Treating the recommendation as the user's decision in the hand-off.

## 9. When to stop converging

Stop when the short list has three to five distinct survivors with a cost and a case against each, and the user has what they need to choose. More analysis after that point serves the analyst. If the user asks for another round, run it, but change something: a lens, a constraint, a criterion. Repeating the same round returns the same list.
