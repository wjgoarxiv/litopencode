// The goal question for a lit-loop or litwork run that has no plan. On the run's first activation, when the
// prompt names an objective and the project has a test command, LitOpenCode records one `kind: "loop"` consent
// and hands the question to a user-visible surface (a TUI toast); it never waits on a test run. The user's exact
// `yes` on a later prompt arms the goal (goal-pipeline.ts answerConsent), and starts no start-work run. With no
// detectable test command the model runs the `litwork` tool's `goal-propose` action after a failing check instead.
import fs from "node:fs";
import path from "node:path";
import { questionForScreen } from "./goal-guide.ts";
import { hasClosedIntent, hasPendingConsent, proposeLoopGoal, readIntent } from "./goal-pipeline.ts";
import { nativeGoalOwnership } from "./native-goal-ledger.ts";
import { withoutSkillHatch } from "./skill-plan.ts";
import { nativeGoalRoute } from "./v2/native-goal.ts";

/** The project's own test command, or undefined when there is none. */
export function detectCheck(projectRoot: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const scripts = typeof manifest === "object" && manifest !== null ? (manifest as { scripts?: unknown }).scripts : undefined;
    if (typeof scripts === "object" && scripts !== null && typeof (scripts as { test?: unknown }).test === "string") return "npm test";
  } catch { // no-excuse-ok: catch -- no readable package.json falls through to the other test commands.
    // The next marker file answers.
  }
  for (const [file, check] of [["pytest.ini", "pytest"], ["pyproject.toml", "pytest"], ["Cargo.toml", "cargo test"], ["go.mod", "go test ./..."]] as const) {
    if (fs.existsSync(path.join(projectRoot, file))) return check;
  }
  return undefined;
}

/** What the prompt asks for: the text after `lit` / `litwork`, without the route word that selected the run. */
export function loopObjective(prompt: string): string {
  const raw = withoutSkillHatch(prompt).replace(/```[\s\S]*?```/gu, " ");
  const match = /(?:^|[^\w])lit(?:work)?(?![\w])\s*([\s\S]*)$/iu.exec(raw);
  return (match?.[1] ?? raw).replace(/^\s*(?:-loop|-work|loop|work|goal|plan|workflow)(?![\w-])\s*/iu, "").trim();
}

/** The model-context line that says the question was shown, so the model never asks it a second time. */
export function loopGoalContext(line: string): string {
  return `Native goal: LitOpenCode has shown the user this goal question: ${line} Do not ask it again. Never type or send /goal yourself: only the user's exact \`yes\` on a later prompt arms it (OpenCode 2 then sets it as its native /goal; OpenCode 1 checks the condition when each turn ends). Until then, keep the durable ledger authoritative.`;
}

/**
 * Records the loop question for a run route's first activation and returns the line to show, or undefined when
 * nothing should be asked: not a run route, no objective, no test command, a goal or a question already open.
 * Call it for a first activation; for a repeated lit (`repeat`) it asks only when this session's earlier goal
 * has closed, so a finished goal never blocks the next question and an open one is never asked twice.
 */
export async function offerLoopGoal(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly mode: string;
  readonly text: string;
  readonly repeat?: boolean;
}): Promise<{ readonly line: string; readonly screen: string } | undefined> {
  try {
    if (input.repeat === true && !hasClosedIntent(input.projectRoot, input.sessionID)) return undefined;
    const route = nativeGoalRoute(input.mode, input.text);
    if (route !== "lit-loop" && route !== "litwork") return undefined;
    const objective = loopObjective(input.text);
    if (objective === "") return undefined;
    const check = detectCheck(input.projectRoot);
    if (check === undefined) return undefined;
    if (readIntent(input.projectRoot, input.sessionID) !== undefined || hasPendingConsent(input.projectRoot)) return undefined;
    if ((await nativeGoalOwnership(input.projectRoot, input.sessionID)).goalID !== undefined) return undefined;
    const offer = proposeLoopGoal({ projectRoot: input.projectRoot, check, objective, sessionID: input.sessionID, falsifyNow: false });
    return offer.consent === undefined ? undefined : { line: offer.line, screen: questionForScreen(offer) };
  } catch { // no-excuse-ok: catch -- a failed goal offer must never block the activation; the run goes on without a goal.
    return undefined;
  }
}
