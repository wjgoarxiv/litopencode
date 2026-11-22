// The answer guide under a goal question, so a first-time user knows what to type and what each word does.
// The question lines and the accepted answers stay as they were. One option list per question feeds both the
// `(yes / edit / no)` tail of the question (goal-pipeline.ts goalStatus) and this guide, so the two cannot drift.
// A TUI toast or notice gets plain aligned lines; a reply the model writes gets a Markdown table.

/** Which question is asked: a plan with a goal, a plan with no goal (start only), or a lit-loop goal. */
export type GoalQuestionKind = "plan-goal" | "plan-start" | "loop";

type AnswerOption = { readonly word: string; readonly does: string };

const answerOptions: Readonly<Record<GoalQuestionKind, readonly AnswerOption[]>> = Object.freeze({
  "plan-goal": [
    { word: "yes", does: "Starts the work now and sets this goal" },
    { word: "edit", does: "Change the goal's check first" },
    { word: "no", does: "Nothing starts" }
  ],
  "plan-start": [
    { word: "yes", does: "Starts the work now, with no goal" },
    { word: "no", does: "Nothing starts" }
  ],
  loop: [
    { word: "yes", does: "Sets this goal for the lit-loop" },
    { word: "no", does: "Keeps working without a goal" }
  ]
});

const headings: Readonly<Record<GoalQuestionKind, string>> = Object.freeze({
  "plan-goal": "approve plan · start work · set goal",
  "plan-start": "approve plan · start work",
  loop: "set goal"
});

const typeAlone = "Type the word alone.";

/** The question's answer tail, for example `(yes / edit / no)`. */
export function answerChoices(kind: GoalQuestionKind): string {
  return `(${answerOptions[kind].map((option) => option.word).join(" / ")})`;
}

/** Plain lines for a toast or notice: no Markdown, short enough for a narrow popup. */
export function plainGoalGuide(kind: GoalQuestionKind): string {
  const options = answerOptions[kind];
  const width = Math.max(...options.map((option) => option.word.length));
  const rows = options.map((option) => `  ${option.word.padEnd(width)}  → ${option.does.charAt(0).toLowerCase()}${option.does.slice(1)}`);
  return [...rows, `  ${typeAlone}`].join("\n");
}

// A code span that survives the backticks a condition carries (`` `npm test` exits 0 ``).
function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return longest === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
}

/** The Markdown block a model-written reply shows under the question. */
export function markdownGoalGuide(kind: GoalQuestionKind, condition?: string): string {
  const lines = [`> **▶ Answer: ${headings[kind]}**`, ">"];
  if (condition !== undefined && condition !== "") lines.push(`> Goal: ${codeSpan(`/goal ${condition}`)}`, ">");
  lines.push("> | Type | What happens |", "> |---|---|");
  for (const option of answerOptions[kind]) lines.push(`> | **\`${option.word}\`** | ${option.does} |`);
  lines.push(">", `> ${typeAlone}`);
  return lines.join("\n");
}

type AskedQuestion = { readonly line: string; readonly kind?: GoalQuestionKind; readonly consent?: { readonly condition: string } };

/** The question with plain guide lines under it, for a toast or notice. A line that asks nothing is returned as is. */
export function questionForScreen(asked: AskedQuestion): string {
  return asked.kind === undefined ? asked.line : `${asked.line}\n${plainGoalGuide(asked.kind)}`;
}

/** The question followed by the instruction to show the Markdown guide under it, for text the model repeats. */
export function questionForModel(asked: AskedQuestion): string {
  if (asked.kind === undefined) return asked.line;
  const words = answerOptions[asked.kind].map((option) => `\`${option.word}\``).join(", ");
  return [
    asked.line,
    `Under that question, end with this answer guide, written in the user's language; keep ${words} as the exact English words:`,
    "",
    markdownGoalGuide(asked.kind, asked.consent?.condition)
  ].join("\n");
}
