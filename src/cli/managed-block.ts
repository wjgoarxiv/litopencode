// A LitFamily block inside a file the user owns (OpenCode's global AGENTS.md, a repo's AGENTS.md): the
// lines between `<!-- litfamily:<id>:start v=<version> -->` and `<!-- litfamily:<id>:end -->`. Only those
// lines are written. The start marker also records what was put in front of the block (`pre=`, hex) and
// whether the file was made for it (`new=1`), so removing the block takes back exactly that and an
// add-then-remove returns the original bytes under any line ending. A start without its end, or two of
// either, is malformed and refused rather than guessed at.

import { Buffer } from "node:buffer";

export class ManagedBlockError extends Error {}

export type ManagedBlock = {
  readonly id: string;
  readonly version: string;
  readonly body: string;
};

export type BlockInspection = {
  readonly state: "absent" | "present" | "malformed";
  readonly version: string | null;
  readonly created: boolean;
};

type Span = {
  readonly start: number;
  readonly end: number;
  readonly version: string;
  readonly pre: string;
  readonly created: boolean;
};

const startOf = (id: string): string => `<!-- litfamily:${id}:start`;
const endOf = (id: string): string => `<!-- litfamily:${id}:end -->`;
const startLine = /^<!-- litfamily:[^:\s]+:start v=(\S+)((?: [a-z]+=[0-9a-f]*)*) -->/u;

function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function positionsOf(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

function locate(text: string, id: string): Span | null {
  const starts = positionsOf(text, startOf(id));
  const ends = positionsOf(text, endOf(id));
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new ManagedBlockError(`malformed LitFamily ${id} block: expected one start marker followed by one end marker`);
  }
  const head = startLine.exec(text.slice(starts[0]));
  if (head === null) throw new ManagedBlockError(`malformed LitFamily ${id} block: unreadable start marker`);
  const attributes = new Map(head[2].trim().split(" ").filter(Boolean).map((pair) => pair.split("=") as [string, string]));
  const pre = attributes.get("pre");
  return {
    start: starts[0],
    end: ends[0] + endOf(id).length,
    version: head[1],
    pre: pre === undefined || pre === "" ? "" : Buffer.from(pre, "hex").toString("utf8"),
    created: attributes.get("new") === "1"
  };
}

function render(block: ManagedBlock, eol: string, added: { readonly pre: string; readonly created: boolean }): string {
  const attributes = `${added.pre === "" ? "" : ` pre=${Buffer.from(added.pre, "utf8").toString("hex")}`}${added.created ? " new=1" : ""}`;
  const body = block.body.replace(/\r?\n$/u, "").split(/\r?\n/u);
  return [`${startOf(block.id)} v=${block.version}${attributes} -->`, ...body, endOf(block.id)].join(eol);
}

export function inspectBlock(text: string, id: string): BlockInspection {
  try {
    const span = locate(text, id);
    return span === null ? { state: "absent", version: null, created: false } : { state: "present", version: span.version, created: span.created };
  } catch {
    return { state: "malformed", version: null, created: false };
  }
}

/** Adds the block, or swaps the bytes between an existing block's markers. `created` marks a file made for the block. */
export function upsertBlock(text: string, block: ManagedBlock, options: { readonly created?: boolean } = {}): { text: string; changed: boolean } {
  const eol = lineEnding(text);
  const span = locate(text, block.id);
  if (span !== null) {
    const next = text.slice(0, span.start) + render(block, eol, span) + text.slice(span.end);
    return { text: next, changed: next !== text };
  }
  const pre = text === "" ? "" : (text.endsWith("\n") ? "" : eol) + eol;
  return { text: text + pre + render(block, eol, { pre, created: options.created === true }) + eol, changed: true };
}

/** Removes the block, the line ending after it and whatever was added in front of it. */
export function removeBlock(text: string, id: string): { text: string; changed: boolean; created: boolean } {
  const span = locate(text, id);
  if (span === null) return { text, changed: false, created: false };
  let before = text.slice(0, span.start);
  let after = text.slice(span.end);
  const eol = after.startsWith("\r\n") ? "\r\n" : after.startsWith("\n") ? "\n" : "";
  after = after.slice(eol.length);
  if (span.pre !== "" && before.endsWith(span.pre)) before = before.slice(0, -span.pre.length);
  return { text: before + after, changed: true, created: span.created };
}
