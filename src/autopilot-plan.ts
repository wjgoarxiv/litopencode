// Reads the parts of a start-work plan that the autopilot driver acts on: the checkbox rows, the
// `## Done when` check, the `Run charter:` commit grant and the `goal: native` opt-in. Every reader
// skips text inside Markdown code fences, so a quoted example in a plan never grants or closes anything.
import { createHash } from "node:crypto";

export type PlanRow = {
  /** The row's own leading number (`- [ ] 3. ...`), else its 1-based position among the rows. */
  readonly number: number;
  readonly checked: boolean;
  readonly text: string;
  /** Zero-based line index in the plan file. */
  readonly lineIndex: number;
  /** `BLOCKED: <reason>` on the row or an indented line under it: a user answer can unblock it. */
  readonly blocked?: string;
  /** `IMPOSSIBLE: <reason>`: no user answer can unblock it. */
  readonly impossible?: string;
};

export type RunCharter = { readonly branch: string; readonly repo: string; readonly line: string };

export type PlanFacts = {
  readonly rows: readonly PlanRow[];
  /** The command on the `check:` line of `## Done when`, backticks removed; undefined when there is none. */
  readonly doneCheck?: string;
  readonly charter?: RunCharter;
  readonly nativeGoal: boolean;
  /** Digest of the lines that grant authority (`Run charter:`, `Scope roots:`), for consent binding. */
  readonly grantDigest: string;
};

type VisibleLine = { readonly line: string; readonly index: number };

export function linesOutsideFences(text: string): readonly VisibleLine[] {
  const visible: VisibleLine[] = [];
  let fence: { readonly marker: string; readonly length: number } | undefined;
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence === undefined && opener !== null) {
      fence = { marker: opener[1][0], length: opener[1].length };
      continue;
    }
    if (fence !== undefined && opener !== null && opener[1][0] === fence.marker && opener[1].length >= fence.length && opener[2].trim() === "") {
      fence = undefined;
      continue;
    }
    if (fence === undefined) visible.push({ line, index });
  }
  return visible;
}

const withoutInlineCode = (line: string): string => line.replace(/`[^`]*`/gu, "");

function marker(kind: "BLOCKED" | "IMPOSSIBLE", line: string, body: boolean): string | undefined {
  const source = withoutInlineCode(line);
  const pattern = body
    ? new RegExp(`^[ \\t]+(?:[-*][ \\t]+)?${kind}:[ \\t]*(.*)$`, "u")
    : new RegExp(`\\b${kind}:[ \\t]*(.*)$`, "u");
  const match = pattern.exec(source);
  if (match === null) return undefined;
  return match[1].trim() === "" ? "(no reason given)" : match[1].trim();
}

export function parsePlanRows(text: string): readonly PlanRow[] {
  const visible = linesOutsideFences(text);
  const rows: PlanRow[] = [];
  for (let at = 0; at < visible.length; at += 1) {
    const match = /^- \[([ xX])\][ \t]+(.+?)[ \t]*$/u.exec(visible[at].line);
    if (match === null) continue;
    let blocked = marker("BLOCKED", match[2], false);
    let impossible = marker("IMPOSSIBLE", match[2], false);
    for (let next = at + 1; next < visible.length && /^(?:[ \t]|$)/u.test(visible[next].line); next += 1) {
      blocked ??= marker("BLOCKED", visible[next].line, true);
      impossible ??= marker("IMPOSSIBLE", visible[next].line, true);
    }
    const own = /^(\d{1,4})[.)][ \t]/u.exec(match[2]);
    rows.push({
      number: own === null ? rows.length + 1 : Number(own[1]),
      checked: match[1].toLowerCase() === "x",
      text: match[2],
      lineIndex: visible[at].index,
      ...(blocked === undefined ? {} : { blocked }),
      ...(impossible === undefined ? {} : { impossible })
    });
  }
  return rows;
}

function sectionLines(visible: readonly VisibleLine[], heading: RegExp): readonly VisibleLine[] {
  const start = visible.findIndex((entry) => heading.test(entry.line));
  if (start < 0) return [];
  const body: VisibleLine[] = [];
  for (const entry of visible.slice(start + 1)) {
    if (/^#{1,2}[ \t]/u.test(entry.line)) break;
    body.push(entry);
  }
  return body;
}

/** True when the plan opts into the host's native goal with its own `goal: native` line outside code fences. */
export function planWantsNativeGoal(text: string): boolean {
  return linesOutsideFences(text).some(({ line }) => /^(?:[-*][ \t]+)?goal:[ \t]*native[ \t]*$/iu.test(line.trim()));
}

export function parsePlanFacts(text: string): PlanFacts {
  const visible = linesOutsideFences(text);
  const done = sectionLines(visible, /^##[ \t]+Done when[ \t]*$/iu);
  const checkLine = done.map((entry) => /^[ \t]*(?:[-*][ \t]+)?check:[ \t]*(.+?)[ \t]*$/iu.exec(entry.line)).find((match) => match !== null);
  const doneCheck = checkLine?.[1] === undefined ? undefined : checkLine[1].replace(/^`+|`+$/gu, "").trim();
  let charter: RunCharter | undefined;
  const grantLines: string[] = [];
  for (const { line } of visible) {
    const clean = line.trim();
    const charterMatch = /^(?:[-*][ \t]+)?Run charter:[ \t]*commit on[ \t]+`?([\w./-]+)`?[ \t]+in[ \t]+`?(.+?)`?[ \t]*\.?$/u.exec(clean);
    if (charterMatch !== null) {
      grantLines.push(clean);
      charter ??= { branch: charterMatch[1], repo: charterMatch[2], line: clean };
    }
    if (/^(?:[-*][ \t]+)?Scope roots:/u.test(clean)) grantLines.push(clean);
  }
  return {
    rows: parsePlanRows(text),
    ...(doneCheck === undefined || doneCheck === "" ? {} : { doneCheck }),
    ...(charter === undefined ? {} : { charter }),
    nativeGoal: planWantsNativeGoal(text),
    grantDigest: createHash("sha256").update(grantLines.join("\n")).digest("hex")
  };
}

/** Ticks the given rows in the plan text, marking each as skipped; other lines stay byte-identical. */
export function tickRowsAsSkipped(text: string, rows: readonly PlanRow[]): string {
  const lines = text.split("\n");
  for (const row of rows) {
    const line = lines[row.lineIndex];
    if (line === undefined) continue;
    const carriage = line.endsWith("\r") ? "\r" : "";
    const bare = carriage === "" ? line : line.slice(0, -1);
    lines[row.lineIndex] = `${bare.replace(/^- \[ \]/u, "- [x]")} (skipped by lit skip-row)${carriage}`;
  }
  return lines.join("\n");
}
