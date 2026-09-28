import fs from "node:fs/promises";
import path from "node:path";
import {
  readerFacingCommunicationContract
} from "../reader-facing-output.ts";
import { noteSessionCompacted, selectRules } from "./engine.ts";
import { readOutputStyleText } from "./output-style.ts";

// Host-surface note, verified against the shipped opencode-ai 1.18.4 binary rather than assumed:
//
// Every OpenCode plugin hook returns Promise<void>; the host consumes a MUTATED output object. For
// the static lane the host passes its own system array straight through --
//   plugin.trigger("experimental.chat.system.transform", {sessionID, model}, {system: l})
// -- so pushing onto output.system reaches the model. It then collapses everything after index 0
// into one joined system message, which appended entries survive.
//
// That same hook has a SECOND call site with no sessionID, used when generating an agent
// configuration rather than serving a user turn. Injecting repository rules there would be wrong, so
// a missing sessionID is treated as "not a chat turn" and the lane stays silent.

export type RulesHookOptions = {
  readonly projectRoot: string;
  readonly homeDir?: string;
  readonly bundledRulesDir?: string;
  readonly outputStyle?: string;
};

export type SystemTransformInput = { readonly sessionID?: string };
export type SystemTransformOutput = { system: string[] };

export async function applyStaticRuleInjection(
  options: RulesHookOptions,
  input: SystemTransformInput,
  output: SystemTransformOutput
): Promise<void> {
  if (typeof input.sessionID !== "string" || input.sessionID.trim() === "") return;
  if (!Array.isArray(output.system)) return;

  const selection = await selectRules({
    lane: "static",
    sessionId: input.sessionID,
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    bundledRulesDir: options.bundledRulesDir
  });
  if (selection.text !== "") output.system.push(selection.text);
  const styleText = await readOutputStyleText(options.outputStyle);
  if (styleText !== "") output.system.push(styleText);
  for (let index = output.system.length - 1; index >= 0; index -= 1) {
    if (output.system[index]?.trimEnd() === readerFacingCommunicationContract) output.system.splice(index, 1);
  }
  output.system.push(readerFacingCommunicationContract);
}

export type CompactingInput = { readonly sessionID: string };
export type CompactingOutput = { context: string[] };

// Compaction drops the earlier prompt, so the delivered set is cleared and rules become eligible
// again on the next turn -- bounded by the re-injection budget.
export async function applyCompactionRuleReset(
  input: CompactingInput,
  output: CompactingOutput
): Promise<void> {
  if (typeof input.sessionID !== "string" || input.sessionID.trim() === "") return;
  const allowed = noteSessionCompacted(input.sessionID);
  if (allowed && Array.isArray(output.context)) {
    output.context.push(
      "LitOpenCode: repository rules will be re-delivered after this compaction. Preserve any rule-derived constraints already agreed in this session."
    );
  }
}

export type DynamicRuleResult = {
  readonly text: string;
  readonly ruleCount: number;
};

// The dynamic lane rides the post-edit hook, whose output.output the host already consumes -- proven
// by the existing post-edit skill routing, not assumed.
export async function dynamicRulesForPaths(
  options: RulesHookOptions,
  sessionId: string,
  mutatedPaths: readonly string[]
): Promise<DynamicRuleResult> {
  if (mutatedPaths.length === 0) return { text: "", ruleCount: 0 };

  const projectRoot = await fs.realpath(path.resolve(options.projectRoot));
  const relativePaths: string[] = [];
  for (const candidate of mutatedPaths) {
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(projectRoot, candidate);
    let canonical: string;
    try {
      canonical = await fs.realpath(resolved);
    } catch {
      continue;
    }
    const canonicalRelative = path.relative(projectRoot, canonical);
    if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) continue;
    relativePaths.push(canonicalRelative);
  }
  if (relativePaths.length === 0) return { text: "", ruleCount: 0 };
  // Discovery walks upward from the edited file, so a nested package's rules outrank the root's by
  // directory distance.
  const startDir = path.dirname(path.resolve(projectRoot, relativePaths[0] ?? "."));

  const selection = await selectRules({
    lane: "dynamic",
    sessionId,
    projectRoot,
    startDir,
    homeDir: options.homeDir,
    bundledRulesDir: options.bundledRulesDir,
    candidatePaths: relativePaths
  });
  return { text: selection.text, ruleCount: selection.selected.length };
}
