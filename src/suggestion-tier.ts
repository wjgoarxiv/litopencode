// The suggestion tier for prompts without `lit`. A small set of gated rules may name skills that fit
// the request; the model then decides yes or no for each and loads only those that fit. Nothing is
// loaded by itself. When no rule fires, one compact catalog line names the common skills instead.
// A rule ships only after it passes the gate in tools/suggestion-eval.mjs (recall >= 0.85 and near-miss
// false positives <= 0.10 on the dev half, then once on the sealed held-out half).

export type SuggestionRule = {
  readonly skill: string;
  readonly purpose: string;
  readonly fires: (text: string) => boolean;
};

const knowledgeQuestion = /^(?:what(?:'s| is| are| does)|why (?:is|are|do|does)|how does|explain|define|tell me about|is it true)\b|\b(?:difference between|what does .* mean)\b|뭐야|뭔가요|무엇인가|설명해|차이(?:가|는|점)|의미가|란\?|이란\b/u;

// "What are my options for X" asks for options to weigh, not for a definition.
const optionsQuestion = /^what (?:are (?:my|our|the) options|options do (?:i|we) have)\b/u;

const plotNoun =/(?<![a-z])(?:plots?|charts?|graphs?|histograms?|scatter ?plots?|heat ?maps?|box ?plots?|line plots?|bar charts?|figures?|error bars?)(?![a-z])|그래프|플롯|차트|히스토그램|산점도|히트맵|시각화/u;
const plotVerb = /(?<![a-z])(?:plot|chart|graph|visuali[sz]e|draw|make|create|render|generate|show|produce|turn)(?![a-z])|그려|만들|시각화|뽑아|보여/u;
const visualizeVerb = /(?<![a-z])visuali[sz]e(?![a-z])|시각화/u;
const dataCue = /(?<![a-z])(?:csv|data|dataset|results?|measurements?|values|columns?|samples?|runs?|logs?|time series|tsv|xlsx|spreadsheet|numbers)(?![a-z])|\.csv\b|데이터|결과|측정|값|수치|로그|실험/u;
const webArtifact = /(?<![a-z])(?:dashboard|web ?page|website|react|component|html|frontend|ui|widget|landing page|d3)(?![a-z])|대시보드|웹페이지|웹사이트|컴포넌트|화면/u;

const diagramNoun = /(?<![a-z])(?:diagrams?|flow ?charts?|architecture (?:map|overview|picture)|sequence diagrams?|state machine diagram|er diagram|mind ?map)(?![a-z])|다이어그램|도식|개념도|개요도|흐름도|구성도|구조도|순서도/u;
const diagramVerb = /(?<![a-z])(?:draw|create|make|design|render|sketch|build|produce|map out|lay out)(?![a-z])|그려|만들|작성|제작|그릴/u;
const physicalSchematic = /(?<![a-z])(?:p&id|pfd|piping|instrumentation|apparatus|equipment layout|cutaway|isometric)(?![a-z])|공정도|계장도|장치도|배관/u;

const docNoun = /(?<![a-z])(?:reports?|docx|word documents?|memos?|proposals?|manuscripts?)(?![a-z])|보고서|기획서|제안서|워드|문서/u;
const authorVerb = /(?<![a-z])(?:make|create|write|draft|prepare|produce|generate|build|put together|turn)(?![a-z])|만들|작성|써줘|제작|준비해|정리해/u;
const plainTextOutput = /(?<![a-z])(?:markdown|plain text|\.md|readme|commit message|email|slack|chat message|comment)(?![a-z])|마크다운|이메일|메일/u;
const toolReport = /(?<![a-z])(?:coverage|test|bug|error|crash|lint|build|lighthouse|status|benchmark) reports?(?![a-z])/u;
const nounAsVerb =/(?<![a-z])(?:excel at|word (?:it|this)|in other words|word choice|slide (?:down|over|into))(?![a-z])/u;

const brainstormCue = /(?<![a-z])(?:brainstorm(?:ing)?|what are my options|what options do i have|give me (?:some )?ideas|ideas for|come up with (?:some )?(?:ideas|names|options)|options for)(?![a-z])|아이디어|브레인스토밍|선택지|방안을? (?:몇 ?가지|여러)/u;
const brainstormExclusion = /(?<![a-z])(?:command[- ]line options?|cli options?|options? (?:flag|object|parameter)|--\w+)(?![a-z])|옵션 플래그/u;

/** Rules that passed the gate, in the order they are offered. No slide-deck rule ships; lit-pptx stays in the catalog line. */
export const suggestionRules: readonly SuggestionRule[] = Object.freeze([
  {
    skill: "lit-scientific-visualization",
    purpose: "publication-grade plots of measured data",
    fires: (text: string) => ((plotNoun.test(text) && plotVerb.test(text)) || visualizeVerb.test(text)) && dataCue.test(text) && !webArtifact.test(text) && !diagramNoun.test(text)
  },
  {
    skill: "lit-diagram-drawer",
    purpose: "conceptual diagrams (architecture, flow, system maps)",
    fires: (text: string) => diagramNoun.test(text) && diagramVerb.test(text) && !physicalSchematic.test(text)
  },
  {
    skill: "lit-docx",
    purpose: "finished Word documents",
    fires: (text: string) => docNoun.test(text) && authorVerb.test(text) && !plainTextOutput.test(text) && !nounAsVerb.test(text) && !toolReport.test(text)
  },
  {
    skill: "lit-brainstorm",
    purpose: "options for an open question, scored and short-listed",
    fires: (text: string) => brainstormCue.test(text) && !brainstormExclusion.test(text)
  }
]);

export const catalogSkills = Object.freeze([
  "lit-plan", "start-work", "review-work", "litresearch", "debugging", "refactor", "deep-interview", "lit-brainstorm",
  "frontend-ui-ux", "visual-qa", "lit-docx", "lit-pptx", "lit-diagram-drawer", "lit-scientific-visualization", "lit-humanizer"
] as const);

export const catalogLine = `LitOpenCode skills you may load with the skill tool when one clearly fits (otherwise none): ${catalogSkills.join(", ")}.`;

/** Removes text that is not the user's own request: code fences, inline code and host notification blocks. */
export function suggestionInput(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/~~~[\s\S]*?~~~/gu, " ")
    .replace(/`[^`\n]*`/gu, " ")
    .replace(/<([a-z][\w-]*(?:notification|reminder|context))\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .toLowerCase();
}

// A prompt that names `lit` or a LitOpenCode workflow, even one too loose to take its route, gets no suggestion.
const namesLitWorkflow = /(?<![a-z0-9_])(?:lit|litwork|litgoal|litresearch|start-work|review-work)(?![a-z0-9_])/u;

export function firedSuggestionRules(text: string): readonly SuggestionRule[] {
  const input = suggestionInput(text);
  if (/(?:^|\s)\/[a-z][\w-]*/u.test(input)) return [];
  const trimmed = input.trim();
  const question = knowledgeQuestion.test(trimmed) && !optionsQuestion.test(trimmed);
  return suggestionRules.filter((rule) => !question && rule.fires(input));
}

/**
 * The note for a prompt that took no lit route, or undefined when none is due (a slash command, an
 * empty prompt). It never decides for the model.
 */
export function suggestionNote(text: string): string | undefined {
  const input = suggestionInput(text);
  if (input.trim() === "" || /(?:^|\s)\/[a-z][\w-]*/u.test(input) || namesLitWorkflow.test(input)) return undefined;
  const fired = firedSuggestionRules(text);
  if (fired.length === 0) return catalogLine;
  return [
    "These LitOpenCode skills may fit this request. Decide yes or no for each and load only the ones that fit with the skill tool; nothing loads by itself:",
    ...fired.map((rule) => `- ${rule.skill}: ${rule.purpose}`),
    "- none: answer directly when no skill fits."
  ].join("\n");
}
