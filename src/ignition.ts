import type { Hooks } from "@opencode-ai/plugin";
import { micro, standard, supportsMarkGlyphs } from "./lit-mark.ts";
import { stripUserFacingBlankHtmlCommentLines } from "./user-facing-markdown.ts";

type TextCompletionHook = NonNullable<Hooks["experimental.text.complete"]>;

// OpenCode renders completion text as Markdown, so never send terminal escape codes here.
export function ignitionMark(first: boolean, _discipline: string, env: NodeJS.ProcessEnv = process.env): string {
  const rows = !supportsMarkGlyphs(env) ? ["LIT"] : first ? standard : micro;
  return ["```text", ...rows, "```"].join("\n");
}

export function createIgnitionState() {
  const seen = new Set<string>();
  const disciplines = new Map<string, string>();
  const plainCompletions = new Set<string>();
  let disposed = false;
  const complete: TextCompletionHook = async (input, output) => {
    const text = stripUserFacingBlankHtmlCommentLines(output.text);
    if (disposed) {
      output.text = text;
      return;
    }
    if (plainCompletions.has(input.sessionID)) {
      output.text = text;
      return;
    }
    const mark = ignitionMark(!seen.has(input.sessionID), disciplines.get(input.sessionID) ?? "lit-loop");
    seen.add(input.sessionID);
    output.text = `${mark}${text === "" ? "" : `\n\n${text}`}`;
  };
  return {
    activate(sessionID: string, skillId: string, showCompletionMark = true): void {
      disciplines.set(sessionID, skillId);
      if (showCompletionMark) plainCompletions.delete(sessionID);
      else plainCompletions.add(sessionID);
    },
    resetDiscipline(sessionID: string): void { disciplines.delete(sessionID); plainCompletions.delete(sessionID); },
    clear(sessionID: string): void { seen.delete(sessionID); disciplines.delete(sessionID); plainCompletions.delete(sessionID); },
    complete,
    dispose(): void { seen.clear(); disciplines.clear(); plainCompletions.clear(); disposed = true; }
  };
}
