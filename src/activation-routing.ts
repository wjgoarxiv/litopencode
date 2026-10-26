import { renamedSkillAliases, skillRenameNote, type RenamedSkillId } from "./skill-renames.ts";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  litHandoffPromptInjection,
  scientificVisualizationPromptInjection
} from "./activation-managed-prompts.ts";
import { litLoopPromptInjection, litPlanPromptInjection, litTaskPromptInjection } from "./activation-primary-prompts.ts";
import { interfaceWorkHandoff } from "./interface-handoff.ts";
import {
  detectWorkflowFamilyChatMode,
  isWorkflowFamilyMode,
  workflowFamilyPrompt,
  type WorkflowFamilyMode
} from "./workflow-families.ts";
import {
  comprehendPromptInjection,
  debuggingPromptInjection,
  deepInterviewPromptInjection,
  frontendUiUxPromptInjection,
  gitMasterPromptInjection,
  litBrainstormPromptInjection,
  litHijackPromptInjection,
  litAdhdPromptInjection,
  litCruciblePromptInjection,
  initDeepPromptInjection,
  litGoalPromptInjection,
  litRecapPromptInjection,
  litResearchPromptInjection,
  lspPromptInjection,
  lspSetupPromptInjection,
  litCodePromptInjection,
  refactorPromptInjection,
  removeAiSlopsPromptInjection,
  reviewModeForcedNote,
  reviewWorkPromptInjection,
  browserDrivePromptInjection,
  structuralSearchPromptInjection,
  startWorkChatPromptInjection,
  visualQaPromptInjection,
  litBurnoffFilePromptInjection,
  litFetchPromptInjection,
  litHumanizerPromptInjection
} from "./activation-workflow-prompts.ts";

export type ChatActivationMode =
  | WorkflowFamilyMode
  | "lit-task"
  | "lit-loop"
  | "lit-plan"
  | "start-work"
  | "review-work"
  | "lit-research"
  | "litgoal"
  | "lit-init"
  | "lit-crucible"
  | "lit-brainstorm"
  | "lit-hijack"
  | "lit-adhd"
  | "lit-burnoff-file"
  | "lit-fetch"
  | "lit-humanizer"
  | "refactor"
  | "lit-burnoff"
  | "lit-code"
  | "debugging"
  | "lit-commit"
  | "lsp"
  | "lsp-setup"
  | "deep-interview"
  | "structural-search"
  | "browser-drive"
  | "frontend-ui-ux"
  | "visual-qa"
  | "lit-recap"
  | "lit-comprehend"
  | "lit-handoff"
  | "lit-scientific-visualization";

const compoundWordBoundary = /^[A-Za-z0-9_-]$/;
const recapWordCharacter = /^[A-Za-z0-9_\u{AC00}-\u{D7A3}\u{1100}-\u{11FF}\u{3130}-\u{318F}]$/u;
const recapBoundedWords = Object.freeze(["recap", "litrecap", "리캡"] as const);
const routeTriggerWords = Object.freeze(["lit", "litopencode", "litwork"] as const);
// D2 route words for lit-brainstorm: `lit brainstorm ...` and its near forms.
const brainstormRouteWords = Object.freeze(["brainstorm", "brainstorming", "ideation", "ideate", "idea", "ideas"] as const);

// frontend-ui-ux is the one skill whose own name nobody types. The measured defect was that
// "design a new settings page UI" surfaced nothing, so the capability was reachable only after the
// editing had already started — backwards for a skill that shapes what gets built. This route is
// therefore intent-shaped rather than name-shaped: a making verb AND a user-interface noun must both
// appear, because either alone is far too common to be a signal.
//
// The `(?<![a-z])` / `(?![a-z])` guards stop `ui` matching inside `build`. They do nothing for
// Hangul, and their Hangul equivalent is deliberately NOTHING — the terms below match as substrings.
// Both guards would be wrong here:
//   a trailing guard breaks agglutination. 디자인해줘, 디자인하고, 디자인할 are one verb with
//   different endings attached directly, so the stem must be allowed to continue into Hangul.
//   a leading guard breaks compounds that are still in scope: 리디자인 (redesign), 홈페이지 and
//   웹페이지 (home/web page) are all things this route should catch.
// Accepted false-positive risk, named: as substrings, 페이지 also matches 매뉴얼 페이지 and 문서
// 페이지, and 화면 also matches 화면 캡처. Paired with a making verb those will fire. They are
// page- and screen-shaped enough that the guidance is not harmful, and the conjunction below — a
// verb AND a noun — remains the real protection, exactly as it is in English.
// 구현 (implement) and 인터페이스 (interface) are excluded for the same reason their English
// counterparts are: in a typed language those words are about types, not screens.
// structural-search is intent-shaped for the same reason frontend-ui-ux is: nobody types the skill
// name. The conjunction is a search-or-rewrite verb AND a noun naming a SYNTAX SHAPE, because either
// alone is far too common — "find the bug" and "the imports are messy" must both stay inert.
//
// THE TWO HALVES ARE DELIBERATELY ASYMMETRIC, and widening them is not equally safe.
// The shape half can be extended freely: the verb half is what rejects "check the call site of this
// bug" and "this declaration is in the wrong file", so adding a near-synonym noun costs nothing.
// The verb half CANNOT be widened the same way. Measured: adding `check` and `update` to it turns 2
// of 7 adversarial prompts into false positives, because compiler vocabulary appears just as often
// in requests that merely DISCUSS a construct as in requests to MATCH one.
// The accepted consequence is a known miss: "show me the call graph" and "list all callers" stay
// silent because `show` and `list` are not search verbs here. A missed structural request costs a
// user one rephrase; a false positive injects a skill into unrelated work. Closeout section 19i
// records the class this vocabulary approach cannot close.
const structuralVerb = /(?<![a-z])(?:find|locate|search|rewrite|replace|migrate|codemod)(?![a-z])/u;
// The shape half admits SYNTACTIC terms only. skills/structural-search/SKILL.md:148 draws the line
// this list must obey — "ask the language server who and what, ask a structural engine what shape" —
// and :149 names the case explicitly: "Finding every caller of a function is a language-server
// question." So callers, call graph, invocations, references to, and usages of are all WHO questions
// and were removed: the router must not contradict the skill's own routing table. Bare `signatures`
// went too, but for a different reason — it fires on "search the changelog for signatures", which is
// cryptography, not code. The qualified form keeps the real case.
const structuralShape = /(?<![a-z])(?:call ?sites?|callsites?|declarations?|import statements?|imports|(?:function|method) signatures?|syntax shapes?|syntax trees?|ast)(?![a-z])/u;

const uiIntentVerb = /(?<![a-z])(?:design|redesign|restyle|revamp|polish|lay\s?out|mock\s?up|build|create|make|implement|add|wire up)(?![a-z])|디자인|만들|제작|개편|다듬|꾸미|구현|추가/u;
const uiIntentNoun = /(?<![a-z])(?:ui|ux|user interface|screen|page|layout|dashboard|modal|navbar|sidebar|stylesheet|css|design system|landing page|front[- ]?end|component|button|card|form|checkout|notification center|comparison table)(?![a-z])|화면|페이지|레이아웃|대시보드|컴포넌트|모달|사이드바|내비게이션|네비게이션|스타일시트|디자인 시스템|랜딩 페이지|프런트엔드|프론트엔드|버튼|카드|폼|체크아웃/u;
// An English build request ("build a landing page for ...") reaches the interface route through the
// generic verbs. A target that is not an interface (a hosted BI tool, a backend, an endpoint, a CLI,
// a schema, a container image) named before the interface noun takes it back out; a design verb
// ("design", "restyle", "polish" ...) is always an interface request. Hangul is left as it was.
const uiDesignVerb = /(?<![a-z])(?:design|redesign|restyle|revamp|polish|lay\s?out|mock\s?up)(?![a-z])|디자인|개편|다듬|꾸미/u;
const uiNonInterfaceTarget = /(?<![a-z])(?:grafana|kibana|datadog|metabase|looker|tableau|power\s?bi|back\s?end|api|endpoint|docker(?:\s?file|\s+image)?|cli|migration|schema)(?![a-z])/u;
function hasUiBuildIntent(raw: string): boolean {
  const verbs = raw.replace(/(?<![a-z])make\s+sure(?![a-z])/gu, " ");
  if (!uiIntentVerb.test(verbs)) return false;
  if (uiDesignVerb.test(verbs)) return true;
  const noun = uiIntentNoun.exec(raw);
  const target = uiNonInterfaceTarget.exec(raw);
  return !(noun && target && target.index < noun.index);
}
const uiPolishCue = /\b(?:polish|tighten up|clean up the styling)\b|다듬/u;
const uiAuditCue = /\b(?:audit|review this page read.only|just check|don't fix)\b|점검|검토만/u;
const uiHardenCue = /\b(?:harden|stress.test|hold up under|robust to)\b|튼튼하게|견고하게/u;
const uiReadOnlyCue = /\b(?:read.only|don't (?:touch|change|fix)|just (?:check|tell))\b|수정은 하지|건드리지 말|고치지는 말|목록만/u;
const uiBuildCue = /\b(?:redesign|new layout|brand.new|add|implement|build|create|make|wire up)\b|새로|추가|구현|다시 짜|재구성/u;
const diagramCreationIntent = /^\s*(?:lit[,:]?\s+)?(?:please\s+)?(?:create|draw|make|design|render|build)\b[^.!?\n]*\b(?:diagrams?|flowcharts?|architecture maps?)\b|^\s*(?:lit\s+)?[^.!?\n]*(?:다이어그램|흐름도|구성도|구조도)[^.!?\n]*(?:그려|만들어|제작해)/mu;
// lit-schematic: a drawing of real hardware (P&ID, PFD, apparatus figure, isometric cutaway). A strong
// noun names a drawing by itself; a weak one (schematic, isometric, apparatus) also needs a drawing or
// making verb and no web-interface noun. A chart of data, a question about a drawing, a review of one,
// or a report or deck about one is not a drawing request, and a whole interface that merely shows a
// drawing belongs to frontend-ui-ux unless the user asked to draw. Hangul terms are bare substrings.
const schematicStrongNoun = /(?<![a-z])p\s?&\s?i\s?ds?(?![a-z])|(?<![a-z])pfds?(?![a-z])|(?<![a-z])bfds?(?![a-z])|piping\s+(?:and|&)\s+instrumentation|process\s+flow\s+(?:diagram|sheet)s?|block\s+flow\s+diagrams?|(?<![a-z])plot\s+plans?(?![a-z])|equipment\s+layouts?|experimental\s+(?:set\s?up|apparatus)|(?<![a-z])cut\s?aways?(?![a-z])|컷어웨이|배관\s?계장도|계장도|공정\s?흐름도|공정도|모식도|장치도|실험\s?장치|피앤아이디|배치도|계통도|단면도/u;
const schematicWeakNoun = /(?<![a-z])schematics?(?![a-z])|(?<![a-z])isometric(?![a-z])|(?<![a-z])apparatus(?![a-z])|사시도|개략도|아이소메트릭|도면/u;
const schematicChartNoun = /차트|그래프|(?<![a-z])(?:charts?|graphs?|plots?(?!\s+plans?(?![a-z])))(?![a-z])/u;
const schematicDrawVerb = /(?<![a-z])(?:draw|drawing|drew|sketch|sketching|illustrate|illustrating|render|rendering|redraw)(?![a-z])|그려|그리|그림|도식|작도/u;
const schematicMakeVerb = /(?<![a-z])(?:make|making|create|creating|design|designing|build|lay\s?out)(?![a-z])|만들|만드/u;
const schematicInterfaceNoun = /(?<![a-z])(?:dashboards?|landing\s?pages?|web\s?pages?|websites?|homepages?|web\s?apps?|apps?|screens?|admin\s?(?:panel|console)|user\s?interface|ui)(?![a-z])|대시보드|웹사이트|랜딩|페이지|화면|앱/u;
const schematicInquiryCue = /(?<![a-z])(?:explain|how (?:do|to|can|does)|what is|what's|review|critique|audit|summari[sz]e|proofread)(?![a-z])|설명|알려|리뷰|검토|점검|요약|뭐야|무엇/u;
// "turn X into a deck/report" also authors an Office file. Within the clause, a dot followed by a
// non-space (notes.md, q3.v2.csv) is part of a file name and does not end the sentence.
const officeAuthoringVerb = /(?<![a-z])(?:make|create|write|draft|prepare|produce|generate|convert|edit|build)(?![a-z])|(?<![a-z])turn(?=(?:[^.!?\n]|\.(?=\S))*?(?<![a-z])into(?![a-z])(?:[^.!?\n]|\.(?=\S))*?(?<![a-z])(?:slides?|decks?|presentations?|pptx?|reports?|documents?|docx|word)(?![a-z]))|만들|작성|써줘|제작|변환|편집/u;
const reportNoun = /(?<![a-z])(?:reports?|documents?|docx|word)(?![a-z])|보고서|리포트|기획서|제안서|문서|워드/u;
// A slide count beside a deck noun ("덱 10장", "a 10-slide launch deck") asks for the deck without a making verb.
// The noun is narrower than slidesNoun: a bare 발표 beside "10장" is a talk or a photo set, not a deck.
const slideCount = /\d+\s?장|(?<![a-z\d])\d+[\s-]?slides?(?![a-z])/u;
const countedDeckNoun = /(?<![a-z])(?:slides?|decks?|presentations?|pptx?)(?![a-z])|발표자료|슬라이드|피피티|덱/u;
const slidesNoun = /(?<![a-z])(?:slides?|decks?|presentations?|pptx?)(?![a-z])|발표자료|발표|슬라이드|피피티|덱/u;
// A deliverable the user asked to receive as Markdown or plain text ("saved as report.md", "in Markdown",
// "as plain text"). An input file such as "turn notes.md into slides" is not one. A named Office or PDF
// output keeps the skill route, because the skill then renders that file from its own source.
const markdownDeliverable = /(?<![a-z])(?:save|saved|saving|write|written|output|deliver|export)\s+(?:(?:it|them|this|both|each)\s+)?(?:as|to|in|into)\s+`?[\w./-]*\.(?:md|markdown|txt)(?![a-z])|(?<![a-z])(?:as|in)\s+(?:plain\s+)?markdown(?![a-z])|(?<![a-z])plain[- ]text(?![a-z])|마크다운(?:으로|\s*파일로|\s*형식)|\.md\s*(?:로|으로|파일로)\s*(?:저장|작성)/u;
const officeFileFormat = /(?<![a-z])(?:docx|pptx?|pdf|word|powerpoint)(?![a-z])|워드|파워포인트|피피티/u;
// lit-typographic-motion (MO-C-18..24). The trigger is a creation verb plus a compound motion-video
// noun, or plus a bare video noun that none of the five exclusions claims. Bare 모션/motion and
// 인트로/intro never trigger alone. The verbs are the office/UI making verbs plus a small motion set
// (render, produce, animate, 뽑아, turn ... into); a verb alone never triggers anything.
const motionVerb = /(?<![a-z])(?:make|create|write|draft|prepare|produce|generate|build|design|render|animate)(?![a-z])|(?<![a-z])turn(?=[^.!?\n]*\binto\b)|만들|작성|써줘|제작|디자인|뽑아|그려/u;
const motionCompound = /(?<![a-z])(?:motion graphics?|typographic motion|kinetic typograph(?:y|ic)|kinetic type|lyric video|music video|title sequence|opening titles?|intro video)(?![a-z])|모션\s?그래픽|타이포\s?모션|키네틱\s?타이포(?:그래피)?|타이포그래피\s?영상|가사\s?영상|리릭\s?(?:비디오|영상)|뮤직\s?비디오|오프닝\s?타이틀|타이틀\s?시퀀스|인트로\s?영상/u;
const motionVideoNoun = /(?<![a-z])(?:videos?|clips?)(?![a-z])|영상|비디오|클립/u;
const existingFootageEdit = /(?<![a-z])(?:edit|editing|caption|captions|subtitle|subtitles|trim|crop|colou?r[- ]?grade)(?![a-z])|편집|자막|색보정|트리밍|잘라|자르/u;
const uiContainer = /(?<![a-z])(?:pages?|web ?sites?|landing|screens?|components?|buttons?)(?![a-z])|페이지|웹사이트|홈페이지|랜딩|화면|컴포넌트|버튼/u;
const insertVideo = /(?<![a-z])(?:embed|insert|add|put)(?![a-z])|background video|넣|삽입|배경\s?(?:영상|비디오)/u;
const officeContainer = /(?<![a-z])(?:slides?|decks?|pptx?|reports?|documents?)(?![a-z])|발표자료|슬라이드|피피티|덱|보고서|문서/u;
const videoAboutArtifact = /(?<![a-z])(?:scripts?|transcripts?|thumbnails?|summar(?:y|ies|ize)|storyboard docs?)(?![a-z])|스크립트|대본|썸네일|요약|기획안/u;

export function hasMotionVideoIntent(raw: string): boolean {
  const compound = motionCompound.test(raw);
  const video = motionVideoNoun.test(raw);
  if (!motionVerb.test(raw) || (!compound && !video)) return false;
  if (video && existingFootageEdit.test(raw)) return false;
  if (uiContainer.test(raw) && insertVideo.test(raw)) return false;
  if (officeContainer.test(raw) && insertVideo.test(raw)) return false;
  if (videoAboutArtifact.test(raw)) return false;
  return true;
}

export function hasSchematicRequest(raw: string): boolean {
  const strong = schematicStrongNoun.test(raw);
  if (!strong && !schematicWeakNoun.test(raw)) return false;
  if (schematicInquiryCue.test(raw) || schematicChartNoun.test(raw)) return false;
  const draws = schematicDrawVerb.test(raw);
  if (!strong && !(draws || schematicMakeVerb.test(raw))) return false;
  if (!strong && uiContainer.test(raw)) return false;
  if (schematicInterfaceNoun.test(raw) && !draws) return false;
  return draws || !(reportNoun.test(raw) || slidesNoun.test(raw));
}

// The route context names the installed render and gate scripts by absolute path. The installed
// managed tree wins; the package's own copy is the fallback when no install is found. Plugin code
// runs inside OpenCode's Bun host, so the command is `node <path>`, never process.execPath.
function installedMotionScript(name: "render.mjs" | "gate.mjs"): string {
  const configHome = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0 ? process.env.XDG_CONFIG_HOME : path.join(os.homedir(), ".config");
  const candidates = [
    ...(process.env.OPENCODE_CONFIG_DIR ? [path.join(process.env.OPENCODE_CONFIG_DIR, "skills", "lit-typographic-motion", name)] : []),
    path.join(configHome, "opencode", "skills", "lit-typographic-motion", name)
  ];
  const installed = candidates.find((candidate) => existsSync(candidate));
  return installed ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "lit-typographic-motion", name);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Optional router hint: a typographic compound, an explicit kinetic-type or lyric request, or a quoted
// span of two or more words. Finding a quote is cue detection only; its words are never followed or
// echoed. The hint never claims the reverse (a missing cue says nothing about the path).
const typeLedCompound = /(?<![a-z])(?:typographic motion|kinetic typograph(?:y|ic)|kinetic type|lyric video|title sequence|opening titles?|typography (?:video|film|clip))(?![a-z])|타이포\s?모션|키네틱\s?타이포(?:그래피)?|타이포그래피\s?영상|타이포\s?영상|가사\s?영상|리릭\s?(?:비디오|영상)|오프닝\s?타이틀|타이틀\s?시퀀스/u;
const quotedSpan = /"([^"\n]+)"|“([^”\n]+)”|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])|「([^」\n]+)」/gu;
export function typeLedCue(raw: string): string | undefined {
  const compound = raw.match(typeLedCompound);
  if (compound) return compound[0];
  for (const match of raw.matchAll(quotedSpan)) {
    const words = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim().split(/\s+/u).filter(Boolean).length;
    if (words >= 2) return `a quoted span of ${words} words`;
  }
  return undefined;
}

// A neutral film context: it never decides the path, only states the rule the treatment applies.
// The cue reads the original request (quotes intact), lowercased; the route decision itself uses
// the quote-stripped text.
function motionRouteContext(original: string): string {
  const render = `node ${shellQuote(installedMotionScript("render.mjs"))}`;
  const gate = `node ${shellQuote(installedMotionScript("gate.mjs"))}`;
  const cue = typeLedCue(original.toLowerCase());
  return `
This is a film request. After the workspace check, load lit-typographic-motion with OpenCode's native skill tool and write treatment.json in the film's output directory before any render. Path rule: the type path when the words themselves are the film, at 16:9; the stage path for every other film and every 9:16 film. ${designChoiceFirst} One call covers path, style, format and register. Ask nothing else; label every invented subject, line and default, and any generated sound, in the reply. Hand-encoded films are not the deliverable. Open the stills with the read tool and record each look. Finish when --done exits 0, else say what it reports open. A README cover or banner loop takes cover mode (references/cover.md).
Commands: ${render} (film, stills, stage, scaffold, styles, assets, blender, cover, sound, look, gate); ${gate} (<dir>, --cover <file>, --done <dir>, --out <dir>).${cue ? `\ntype-led cue found: ${cue}` : ""}
`;
}
const litSlashCommands = Object.freeze([
  ...Object.values(renamedSkillAliases).flat(),
  "lit-burnoff-file",
  "lit-fetch",
  "lit",
  "lit-loop",
  "lit-plan",
  "litwork",
  "lit-work",
  "start-work",
  "review-work",
  "lit-research",
  "litresearch",
  "lit-goal",
  "litgoal",
  "lit-init",
  "lit-crucible",
  "lit-brainstorm",
  "lit-hijack",
  "lit-adhd",
  "lit-rewind",
  "refactor",
  "lit-burnoff",
  "lit-code",
  "debugging",
  "lit-commit",
  "lsp",
  "lsp-setup",
  "rules",
  "deep-interview",
  "structural-search",
  "browser-drive",
  "lit-recap",
  "lit-comprehend",
  "lit-handoff",
  "lit-scientific-visualization",
  "lit-humanizer",
  "lit-korean",
  "text-naturalization",
  "text-neutralization",
  "korean-ai-slop-remover",
  "autoresearch",
  "autoresearch-debug",
  "autoresearch-fix",
  "autoresearch-learn",
  "autoresearch-plan",
  "autoresearch-predict",
  "autoresearch-reason",
  "autoresearch-scenario",
  "autoresearch-security",
  "autoresearch-ship",
  "autoconference",
  "autoconference-analyze",
  "autoconference-debate",
  "autoconference-plan",
  "autoconference-resume",
  "autoconference-ship",
  "autoconference-survey",
  "wikify-init",
  "wikify-ingest",
  "wikify-query",
  "wikify-save",
  "wikify-lint"
] as const);

export function containsStandaloneLitTrigger(text: string): boolean {
  return detectChatActivationMode(text) !== undefined;
}

function withoutInactiveContent(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*>.*$/gmu, " ")
    .replace(/"[^"\r\n]*"/gu, " ")
    .replace(/“[^”\r\n]*”|‘[^’\r\n]*’/gu, " ")
    .replace(/(^|[\s([{])'[^'\r\n]*'(?=$|[\s)\]},.!?;:])/gmu, "$1 ");
}

function normalizedTriggerText(text: string): string {
  return withoutInactiveContent(text).toLowerCase().replace(/[_-]+/g, " ");
}

function rawTriggerText(text: string): string {
  return withoutInactiveContent(text).toLowerCase();
}

function hasLitTrigger(text: string): boolean {
  return containsCompoundBoundedWord(text, "lit") || containsCompoundBoundedWord(text, "litwork") || containsCompoundBoundedWord(text, "litopencode");
}

function containsRecapTrigger(text: string): boolean {
  return recapBoundedWords.some((word) => containsCompoundBoundedWord(text, word, recapWordCharacter));
}

function routeWords(text: string): readonly string[] {
  return text.match(/[a-z0-9]+/g) ?? [];
}

function containsLitRoute(words: readonly string[], ...route: readonly string[]): boolean {
  for (let index = 0; index < words.length; index += 1) {
    if (!routeTriggerWords.includes(words[index] as (typeof routeTriggerWords)[number])) continue;
    if (route.every((word, offset) => words[index + offset + 1] === word)) return true;
  }
  return false;
}

// The brainstorm route is the word right after the FIRST standalone `lit` token. A path or file name
// (`plans/lit-ideas.md`, `src/lit-idea.ts`) is not a `lit` token, and a later `lit idea` inside the
// arguments of another route (`lit plan the lit ideas page`) is not the route word.
const standaloneLitToken = new RegExp(`(?<![\\w./\\\\~@$-])(?:${routeTriggerWords.join("|")})(?!\\w)`, "u");
const brainstormRouteAfterLit = new RegExp(`^(?:\\s+(?:${brainstormRouteWords.join("|")})|-brainstorm)(?![\\w/\\\\-]|\\.\\w)`, "u");

function startsBrainstormRoute(raw: string): boolean {
  const token = standaloneLitToken.exec(raw);
  return token !== null && brainstormRouteAfterLit.test(raw.slice(token.index + token[0].length));
}

// The hijack route follows the brainstorm rule: the word right after the FIRST standalone `lit` token.
// `lit debug the session hijack` and `how do attackers hijack a session cookie` stay with their own
// routes because the route word is not adjacent to `lit`. The Hangul forms attach particles and verb
// endings directly (하이재킹해줘, 하이잭해서), so they carry no trailing boundary.
const hijackRouteAfterLit = new RegExp("^(?:\\s+hijack(?:ing)?|-hijack)(?![\\w/\\\\-]|\\.\\w)|^\\s+(?:하이재킹|하이잭)", "u");

function startsHijackRoute(raw: string): boolean {
  const token = standaloneLitToken.exec(raw);
  return token !== null && hijackRouteAfterLit.test(raw.slice(token.index + token[0].length));
}

// `lit adhd` and `lit rewind` follow the same rule: the route word is the word right after the first `lit`.
// `lit debug the adhd screening form` and `how to rewind a git branch` keep their own routes.
const adhdRouteAfterLit = /^(?:\s+(?:adhd|rewind)|-(?:adhd|rewind))(?![\w/\\-]|\.\w)/iu;

function startsAdhdRoute(raw: string): boolean {
  const token = standaloneLitToken.exec(raw);
  return token !== null && adhdRouteAfterLit.test(raw.slice(token.index + token[0].length));
}

function startsWithStartWorkInvocation(raw: string, normalized: string): boolean {
  const rawStart = raw.trimStart();
  if (/^start-work(?:$|[\s,.:;!?])/u.test(rawStart)) return true;
  return /^lit\s+start\s+work(?:$|[\s,.:;!?])/u.test(normalized.trimStart());
}

export function endsWithStandaloneLitInvocation(raw: string): boolean {
  return /(?:^|\s)lit[.!?]*$/u.test(raw.trim());
}

// `opencode run` JSON-quotes its sole message argument before chat.message.
// Match that exact host wrapper to argv; a user-supplied quoted example stays inert.
export function unwrapOpenCodeRunMessage(text: string, argv: readonly string[]): string {
  if (!argv.slice(2).includes("run")) return text;
  const argument = argv.at(-1);
  return argument !== undefined && text === JSON.stringify(argument) ? argument : text;
}

function explicitlyRequestsLongWork(text: string): boolean {
  return /\b(?:lit[- ]loop|long[- ]running (?:task|work|project)|multi[- ]turn|across (?:multiple )?turns|over (?:multiple|several) turns|in-depth research|durable (?:workflow|goal|task|state|ledger)|continue until (?:all|every)\b)/iu.test(text);
}

function containsLitSlashCommandMention(text: string): boolean {
  const mentions = text.match(/(^|\s)\/([A-Za-z][\w-]*)/gu) ?? [];
  return mentions.some((mention) => litSlashCommands.includes(mention.trim().slice(1) as (typeof litSlashCommands)[number]));
}

export function detectChatActivationMode(text: string, agent?: string): ChatActivationMode | undefined {
  if (text.trim().toLowerCase() === "handoff") return "lit-handoff";
  if (text.trim().toLowerCase() === "lit-scientific-visualization") return "lit-scientific-visualization";
  const raw = rawTriggerText(text);
  const normalized = normalizedTriggerText(text);
  const words = routeWords(normalized);
  if (containsLitSlashCommandMention(raw)) return undefined;
  // An explicit `lit brainstorm ...` invocation wins over every word-anywhere route below, so a later
  // "refactor", "plan" or "dashboard" in the same sentence cannot steal the open question.
  if (startsBrainstormRoute(raw)) return "lit-brainstorm";
  // Same precedence for `lit hijack ...`: porting a published technique outranks the plan, review and
  // research words that its sources and targets usually contain.
  if (startsHijackRoute(raw)) return "lit-hijack";
  // Coming back to earlier work outranks the plan and research words a brief request may contain.
  if (startsAdhdRoute(raw)) return "lit-adhd";
  const workflowFamilyMode = detectWorkflowFamilyChatMode(raw);
  if (workflowFamilyMode !== undefined) return workflowFamilyMode;
  if (containsRenamedSkillTrigger(raw, "lit-crucible")) return "lit-crucible";
  if (containsRenamedSkillTrigger(raw, "lit-init")) return "lit-init";
  if (/^(?:litresearch|lit-research)(?:$|[\s,.:;!?])/u.test(raw.trimStart())) return "lit-research";
  if (startsWithStartWorkInvocation(raw, normalized)) return "start-work";
  if (containsCompoundBoundedWord(raw, "review-work")) return "review-work";
  if (containsRenamedSkillTrigger(raw, "litgoal") || containsCompoundBoundedWord(raw, "lit-goal")) return "litgoal";
  if (containsRecapTrigger(raw)) return "lit-recap";
  if (containsCompoundBoundedWord(raw, "lit-comprehend")) return "lit-comprehend";
  if (containsCompoundBoundedWord(raw, "lit comprehend")) return "lit-comprehend";
  if (containsCompoundBoundedWord(raw, "$lit-comprehend")) return "lit-comprehend";
  if (containsCompoundBoundedWord(raw, "comprehend")) return "lit-comprehend";
  if (containsCompoundBoundedWord(raw, "$comprehend")) return "lit-comprehend";
  if (containsRenamedSkillTrigger(raw, "lit-burnoff")) return "lit-burnoff";
  if (containsRenamedSkillTrigger(raw, "lit-commit")) return "lit-commit";
  if (containsCompoundBoundedWord(raw, "refactor")) return "refactor";
  if (containsRenamedSkillTrigger(raw, "lit-code")) return "lit-code";
  if (containsRenamedSkillTrigger(raw, "lit-burnoff-file")) return "lit-burnoff-file";
  if (containsRenamedSkillTrigger(raw, "lit-fetch")) return "lit-fetch";
  if (containsRenamedSkillTrigger(raw, "lit-humanizer")) return "lit-humanizer";
  if (containsCompoundBoundedWord(raw, "deep-interview")) return "deep-interview";
  if (containsCompoundBoundedWord(raw, "debugging")) return "debugging";
  // lsp-setup is checked first for readability; the compound boundary already keeps the two apart,
  // because the hyphen in `lsp-setup` is itself a word character for this matcher.
  if (containsCompoundBoundedWord(raw, "lsp-setup")) return "lsp-setup";
  if (containsCompoundBoundedWord(raw, "lsp")) return "lsp";
  if (containsCompoundBoundedWord(raw, "structural-search")) return "structural-search";
  // browser-drive is name-only on purpose. A prompt that merely mentions a browser, a URL, or the
  // web is not a request to drive one, and over-firing is a recorded defect shape in this family.
  if (containsCompoundBoundedWord(raw, "browser-drive")) return "browser-drive";
  if (structuralVerb.test(raw) && structuralShape.test(raw)) return "structural-search";
  // visual-qa is name-shaped: the id is distinctive enough to be its own trigger, hyphenated or spaced.
  if (containsCompoundBoundedWord(raw, "visual-qa") || containsCompoundBoundedWord(raw, "visual qa")) return "visual-qa";
  if (containsCompoundBoundedWord(raw, "frontend-ui-ux")) return "frontend-ui-ux";
  // MO-C-18: a motion-video request is decided before the interface route. Without lit it takes
  // no route at all (there is no bare motion route, and the UI fallback must not claim it); with
  // lit it continues to the ordinary lit routes below, which the office route never precedes.
  const motion = hasMotionVideoIntent(raw);
  if (motion && !hasLitTrigger(raw)) return undefined;
  if (!motion && hasLitTrigger(raw) && uiContainer.test(raw) && insertVideo.test(raw) && motionVideoNoun.test(raw)) return "frontend-ui-ux";
  const schematic = hasLitTrigger(raw) && hasSchematicRequest(raw);
  if (!motion && !schematic && uiIntentNoun.test(raw) && (hasUiBuildIntent(raw) || uiAuditCue.test(raw) || uiHardenCue.test(raw))) return "frontend-ui-ux";
  if (!hasLitTrigger(raw)) return undefined;
  if (containsLitRoute(words, "review")) return "review-work";
  if (containsLitRoute(words, "research")) return "lit-research";
  if (containsLitRoute(words, "goal")) return "litgoal";
  if (containsLitRoute(words, "plan")) return "lit-plan";
  if (
    (containsCompoundBoundedWord(raw, "start-work") || containsLitRoute(words, "start", "work")) &&
    !endsWithStandaloneLitInvocation(raw)
  ) return undefined;
  if (agent === "lit-plan") return "lit-plan";
  if (schematic) return "lit-task";
  return containsLitRoute(words, "loop") || explicitlyRequestsLongWork(raw) ? "lit-loop" : "lit-task";
}

const designChoiceFirst = `Before building, unless the prompt names the theme, style or preset or says "you choose", ask the user to pick it with OpenCode's question tool: two to four options, the recommended one first. In a non-interactive run with no question tool, take the recommended option and say so in one line.`;

export function promptForChatActivationMode(mode: ChatActivationMode, triggerText = ""): string {
  const prompt = canonicalChatPrompt(mode);
  const raw = rawTriggerText(triggerText);
  let targetedPrompt = prompt;
  if (mode === "frontend-ui-ux") {
    const uiMode = frontendUiUxModeForPrompt(raw);
    targetedPrompt += `\nSelected interface mode: ${uiMode}. Follow references/production.md for that mode's edit boundary and probe gate.`;
    if (uiMode === "build") targetedPrompt += `\nNew page or screen: ${designChoiceFirst} Then, before any markup, lock the look with scripts/design-lock.mjs (one house style, one layout family, one signature moment; existing brand tokens win) and build only from the generated ui/tokens.css, ui/components.css and layout starter, as references/house-styles.md describes. Rich density is the default; calm only when the request asks for minimal or calm. The probe also checks the lock: fix HIGH findings, answer its LOOK questions on the screenshots, and report a missing capture as BLOCKED.`;
  }
  if (mode === "review-work") targetedPrompt += reviewModeForcedNote(forcedReviewMode(routeWords(normalizedTriggerText(triggerText))) ?? "");
  if (mode === "lit-loop" && needsInterfaceHandoff(raw)) targetedPrompt += `\nInterface hand-off for this request: ${interfaceWorkHandoff}`;
  const schematic = mode === "lit-task" && hasSchematicRequest(raw);
  if (schematic) {
    targetedPrompt = targetedPrompt.replace("</lit-task-mode>", `
After the workspace check, use OpenCode's native skill tool to load lit-schematic before drawing the requested physical schematic: a P&ID, PFD, apparatus figure or isometric cutaway. Resolve its scripts and references from the skill location returned by OpenCode. ${designChoiceFirst} Write the process truth and parts list first, build with the skill's kit, run its qa.mjs until QA PASS, render the PNG and open it. Under lit, when data is missing, draw a realistic example without asking and label every invented value in the reply. A cutaway asked as an animation is drawn there as a silent loop; a titled or narrated film goes to lit-typographic-motion. If the skill is unavailable, report that limit instead of claiming it ran.
</lit-task-mode>`);
  }
  if (!schematic && (mode === "lit-task" || mode === "lit-loop") && hasMotionVideoIntent(raw)) {
    return mode === "lit-task"
      ? targetedPrompt.replace("</lit-task-mode>", `${motionRouteContext(triggerText)}</lit-task-mode>`)
      : `${targetedPrompt}\nFilm request:${motionRouteContext(triggerText)}`;
  }
  if (mode === "lit-task" && !schematic && diagramCreationIntent.test(raw)) {
    targetedPrompt = targetedPrompt.replace("</lit-task-mode>", `
After the workspace check, use OpenCode's native skill tool to load lit-diagram-drawer before authoring the requested conceptual diagram. This is the one narrowly relevant skill for this bounded task. Resolve resources from the skill location returned by OpenCode. ${designChoiceFirst} Follow its verification and export steps, and inspect the final PNG. If the skill is unavailable, report that limit instead of claiming it ran.
</lit-task-mode>`);
  }
  if (mode === "lit-task" && !schematic && officeAuthoringVerb.test(raw) && markdownDeliverable.test(raw) && !officeFileFormat.test(raw) && (reportNoun.test(raw) || slidesNoun.test(raw))) {
    targetedPrompt = targetedPrompt.replace("</lit-task-mode>", `
The requested deliverable is a Markdown or plain-text file, not an Office file. Write each named file as ordinary Markdown that a reader opens directly: headings, paragraphs, lists and tables, with no YAML front matter, no \`:::\` directive blocks and no tonality, layout or title-treatment keys. Do not build a DOCX or PPTX and do not load lit-docx or lit-pptx for it; their Markdown is converter source and belongs only beside a file that skill renders.
</lit-task-mode>`);
  } else if (mode === "lit-task" && !schematic && (officeAuthoringVerb.test(raw) || (slideCount.test(raw) && countedDeckNoun.test(raw)))) {
    const skills = [reportNoun.test(raw) ? "lit-docx" : undefined, slidesNoun.test(raw) ? "lit-pptx" : undefined].filter(Boolean);
    if (skills.length > 0) targetedPrompt = targetedPrompt.replace("</lit-task-mode>", `
After the workspace check, use OpenCode's native skill tool to load ${skills.join(" and ")} before drafting the requested Office deliverable. Resolve scripts and templates from the installed skill location. Under lit, create the editable ${skills.includes("lit-docx") ? "DOCX" : ""}${skills.length === 2 ? " and " : ""}${skills.includes("lit-pptx") ? "PPTX" : ""} with its Markdown source; unless the user selected a tonality, profile or template, rank its design direction (tonality) with two alternatives. ${designChoiceFirst} If facts are missing, complete a realistic example without asking or leaving placeholders; mark invented names and figures as sample assumptions in the file and reply. Run its QA and inspect rendered pages or slides. Report missing optional host tools honestly. If a skill is unavailable, report that limit instead of claiming it ran.
</lit-task-mode>`);
  }
  const alias = (Object.keys(renamedSkillAliases) as RenamedSkillId[]).find(
    (id) => id === mode && renamedSkillAliases[id].some((name) => containsCompoundBoundedWord(raw, name))
  );
  if (alias === undefined) return targetedPrompt;
  const oldName = renamedSkillAliases[alias].find((name) => containsCompoundBoundedWord(raw, name));
  return oldName === undefined ? targetedPrompt : `${skillRenameNote(alias, oldName)}\n${targetedPrompt}`;
}

// `lit review plan` / `lit review work` (and `review-work plan` / `review-work work`) force a review mode.
function forcedReviewMode(words: readonly string[]): "plan" | "work" | undefined {
  for (const mode of ["plan", "work"] as const) {
    if (containsLitRoute(words, "review", mode)) return mode;
  }
  for (let index = 0; index + 2 < words.length; index += 1) {
    const next = words[index + 2];
    if (words[index] === "review" && words[index + 1] === "work" && (next === "plan" || next === "work")) return next;
  }
  return undefined;
}

export function frontendUiUxModeForPrompt(text: string): "build" | "polish" | "audit" | "harden" {
  const raw = rawTriggerText(text);
  if (!uiIntentNoun.test(raw)) return "build";
  if (uiAuditCue.test(raw) && uiReadOnlyCue.test(raw)) return "audit";
  if (uiHardenCue.test(raw) && !/\b(?:brand.new|new)\b|새로/u.test(raw)) return "harden";
  if (uiBuildCue.test(raw) && !uiReadOnlyCue.test(raw)) return "build";
  if (uiAuditCue.test(raw) && !/\bfix\b|고쳐|수정해/u.test(raw)) return "audit";
  if (uiPolishCue.test(raw)) return "polish";
  return "build";
}

function needsInterfaceHandoff(raw: string): boolean {
  if (/\b(?:cli|backend|api|server)[- ]only\b/u.test(raw)) return false;
  return hasUiBuildIntent(raw) && (uiIntentNoun.test(raw) || /\b(?:web ?app|website)\b|웹앱|웹사이트|홈페이지/u.test(raw));
}

function canonicalChatPrompt(mode: ChatActivationMode): string {
  if (isWorkflowFamilyMode(mode)) return workflowFamilyPrompt(mode);
  switch (mode) {
    case "lit-task":
      return litTaskPromptInjection;
    case "lit-loop":
      return litLoopPromptInjection;
    case "lit-plan":
      return litPlanPromptInjection;
    case "start-work":
      return startWorkChatPromptInjection;
    case "review-work":
      return reviewWorkPromptInjection;
    case "lit-research":
      return litResearchPromptInjection;
    case "litgoal":
      return litGoalPromptInjection;
    case "lit-init":
      return initDeepPromptInjection;
    case "lit-burnoff-file":
      return litBurnoffFilePromptInjection;
    case "lit-fetch":
      return litFetchPromptInjection;
    case "lit-humanizer":
      return litHumanizerPromptInjection;
    case "lit-crucible":
      return litCruciblePromptInjection;
    case "lit-brainstorm":
      return litBrainstormPromptInjection;
    case "lit-hijack":
      return litHijackPromptInjection;
    case "lit-adhd":
      return litAdhdPromptInjection;
    case "refactor":
      return refactorPromptInjection;
    case "lit-burnoff":
      return removeAiSlopsPromptInjection;
    case "lit-code":
      return litCodePromptInjection;
    case "debugging":
      return debuggingPromptInjection;
    case "lit-commit":
      return gitMasterPromptInjection;
    case "lsp":
      return lspPromptInjection;
    case "lsp-setup":
      return lspSetupPromptInjection;
    case "deep-interview":
      return deepInterviewPromptInjection;
    case "structural-search":
      return structuralSearchPromptInjection;
    case "browser-drive":
      return browserDrivePromptInjection;
    case "frontend-ui-ux":
      return frontendUiUxPromptInjection;
    case "visual-qa":
      return visualQaPromptInjection;
    case "lit-recap":
      return litRecapPromptInjection;
    case "lit-comprehend":
      return comprehendPromptInjection;
    case "lit-handoff":
      return litHandoffPromptInjection;
    case "lit-scientific-visualization":
      return scientificVisualizationPromptInjection;
  }
}

function containsRenamedSkillTrigger(text: string, id: RenamedSkillId): boolean {
  return containsCompoundBoundedWord(text, id) || renamedSkillAliases[id].some((alias) => containsCompoundBoundedWord(text, alias));
}

function containsCompoundBoundedWord(
  text: string,
  word: string,
  wordCharacter: RegExp = compoundWordBoundary
): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (!text.startsWith(word, index)) continue;
    const previous = index === 0 ? undefined : text[index - 1];
    const next = text[index + word.length];
    if (isCompoundWordBoundary(previous, wordCharacter) && isCompoundWordBoundary(next, wordCharacter)) return true;
  }
  return false;
}

function isCompoundWordBoundary(value: string | undefined, wordCharacter: RegExp): boolean {
  return value === undefined || !wordCharacter.test(value);
}
