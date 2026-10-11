// OpenCode reads its config as JSONC (line and block comments, trailing commas). Comments are blanked
// in place, keeping every offset, so structure found in the blanked copy addresses the original text.

type Member = { readonly key: string; readonly valueStart: number; readonly valueEnd: number };

export type JsoncEdit = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly key: string };

function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === '"') return index + 1;
    else index += 1;
  }
  return text.length;
}

function blankComments(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      const end = stringEnd(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index);
      const end = newline === -1 ? text.length : newline;
      out += " ".repeat(end - index);
      index = end;
    } else if (text.startsWith("/*", index)) {
      const close = text.indexOf("*/", index + 2);
      if (close === -1) {
        throw new SyntaxError(`Unterminated block comment in JSONC starting at line ${text.slice(0, index).split("\n").length}`);
      }
      const end = close + 2;
      out += text.slice(index, end).replace(/[^\r\n]/gu, " ");
      index = end;
    } else {
      out += text[index];
      index += 1;
    }
  }
  return out;
}

function blankTrailingCommas(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      const end = stringEnd(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (text[index] === "," && /^\s*[\]}]/u.test(text.slice(index + 1))) out += " ";
    else out += text[index];
    index += 1;
  }
  return out;
}

const bom = "\uFEFF";

function withoutBom(text: string): string {
  return text.startsWith(bom) ? text.slice(1) : text;
}

export function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(blankTrailingCommas(blankComments(withoutBom(text))));
}

export function hasJsoncComments(text: string): boolean {
  return blankComments(text) !== text;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  return index;
}

function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] !== "{" && text[start] !== "[") {
    let index = start;
    while (index < text.length && !/[\s,\]}]/u.test(text[index])) index += 1;
    return index;
  }
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = stringEnd(text, index);
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    index += 1;
    if (depth === 0) return index;
  }
  return index;
}

// `blanked` is text that already parsed as a JSONC object, with its comments blanked.
function topLevelMembers(blanked: string): { readonly close: number; readonly members: readonly Member[] } {
  const members: Member[] = [];
  let index = skipWhitespace(blanked, 0) + 1;
  for (;;) {
    index = skipWhitespace(blanked, index);
    if (blanked[index] === ",") index = skipWhitespace(blanked, index + 1);
    if (blanked[index] === "}" || index >= blanked.length) return { close: index, members };
    const keyEnd = stringEnd(blanked, index);
    const key = JSON.parse(blanked.slice(index, keyEnd)) as string;
    const valueStart = skipWhitespace(blanked, skipWhitespace(blanked, keyEnd) + 1);
    const end = valueEnd(blanked, valueStart);
    members.push({ key, valueStart, valueEnd: end });
    index = end;
  }
}

function formatValue(value: unknown, eol = "\n"): string {
  return JSON.stringify(value, null, 2).replace(/\n/gu, `${eol}  `);
}

export function formatJsoncMember(key: string, value: unknown, eol = "\n"): string {
  return `${JSON.stringify(key)}: ${formatValue(value, eol)}`;
}

/**
 * Rewrites only the top-level entries of `text` whose value differs from `next`, leaving every other
 * byte (comments, a leading BOM and the line ending included) in place. Refuses, naming the entry,
 * when an edited value holds a comment or when an entry would have to be removed.
 */
export function editJsoncObject(text: string, next: Record<string, unknown>): JsoncEdit {
  if (text.startsWith(bom)) {
    const edit = editJsoncObject(text.slice(1), next);
    return edit.ok ? { ok: true, text: bom + edit.text } : edit;
  }
  const eol = lineEnding(text);
  const current = parseJsonc(text) as Record<string, unknown>;
  const removed = Object.keys(current).find((key) => !(key in next));
  if (removed !== undefined) return { ok: false, key: removed };
  let edited = text;
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    const blanked = blankComments(edited);
    const { close, members } = topLevelMembers(blanked);
    const member = [...members].reverse().find((candidate) => candidate.key === key);
    if (member !== undefined) {
      if (blanked.slice(member.valueStart, member.valueEnd) !== edited.slice(member.valueStart, member.valueEnd)) {
        return { ok: false, key };
      }
      edited = edited.slice(0, member.valueStart) + formatValue(value, eol) + edited.slice(member.valueEnd);
      continue;
    }
    let lineStart = close;
    while (lineStart > 0 && (edited[lineStart - 1] === " " || edited[lineStart - 1] === "\t")) lineStart -= 1;
    const ownLine = lineStart > 0 && edited[lineStart - 1] === "\n";
    const at = ownLine ? lineStart : close;
    edited = edited.slice(0, at) + (ownLine ? "" : eol) + "  " + formatJsoncMember(key, value, eol) + eol + edited.slice(at);
    const last = members.at(-1);
    if (last !== undefined && !blanked.slice(last.valueEnd, close).includes(",")) {
      edited = edited.slice(0, last.valueEnd) + "," + edited.slice(last.valueEnd);
    }
  }
  return { ok: true, text: edited };
}
