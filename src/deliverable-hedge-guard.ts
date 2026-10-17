import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childNodeExecutable } from "./cli/auto-update.ts";
import { mutatedFilePaths, type ToolGuardAfterOutput, type ToolGuardRequest } from "./tool-guards.ts";

export type HumanizerFinding = {
  readonly file: string;
  readonly rule: string;
  readonly severity: "block" | "warn";
  readonly line: number;
  readonly excerpt: string;
};

export type HumanizerScanRequest = {
  readonly file: string;
  readonly oldText: string;
  readonly newText: string;
};

export type HumanizerScan = (request: HumanizerScanRequest) => Promise<readonly HumanizerFinding[]>;

export type DeliverableHedgeGuardOptions = {
  readonly projectRoot: string;
  readonly timeoutMs?: number;
  readonly scan?: HumanizerScan;
};

export type DeliverableHedgeGuardState = {
  readonly before: (input: ToolGuardRequest) => Promise<void>;
  readonly after: (input: ToolGuardRequest, output: ToolGuardAfterOutput) => Promise<void>;
  readonly dispose: () => void;
};

const defaultTimeoutMs = 1500;
const maxTextBytes = 4 * 1024 * 1024;
const maxOutputBytes = 16 * 1024 * 1024;
const maxPendingCalls = 512;
// Prose formats only: in config and data files (YAML, JSON, XML, CSV, TSV) a line such as `source:` is a key.
const readerFacingExtensions = new Set([
  ".adoc", ".html", ".htm", ".md", ".mdx", ".org", ".rst", ".svg", ".tex", ".txt", ".xhtml"
]);
const officeExtensions = new Set([".docx", ".pptx", ".pdf"]);
const packageSkillRoot = fileURLToPath(new URL("../skills/lit-humanizer", import.meta.url));
const detectorWorker = path.join(packageSkillRoot, "scripts", "guard-scan.mjs");
const officeExtractor = path.join(packageSkillRoot, "scripts", "extract_office_text.py");

type WorkerOutput = { readonly findings: readonly HumanizerFinding[] };
type PendingNotice = { readonly message: string; readonly tier: "warn" | "unavailable" };
type ToolRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is ToolRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isInternalPath(candidate: string): boolean {
  const segments = path.normalize(candidate).split(/[\\/]+/u);
  return segments.some((segment) => segment === "plans" || segment === "evidence" ||
    segment.toLowerCase() === ".hermes" || segment.toLowerCase() === "ledgers" ||
    segment.startsWith(".lit") || /^HANDOFF/iu.test(segment));
}

function oneLine(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").slice(0, 180) || "unknown error";
}

function displayPath(file: string): string {
  return file.replace(/[\r\n\t]+/gu, " ").slice(0, 120);
}

function toolText(input: ToolGuardRequest): { readonly file: string; readonly value?: string; readonly unavailable?: string } | undefined {
  if (input.tool !== "write" && input.tool !== "edit") return undefined;
  if (!isRecord(input.args)) return undefined;
  const paths = mutatedFilePaths(input.args);
  const candidate = paths[0];
  if (candidate === undefined || isInternalPath(candidate)) return undefined;
  const extension = path.extname(candidate).toLowerCase();
  if (!readerFacingExtensions.has(extension)) return undefined;

  const args = input.args;
  const keys = input.tool === "write" ? ["content"] : ["newString", "new_string"];
  const values = keys.map((key) => args[key]).filter((value): value is string => typeof value === "string");
  if (values.length !== 1) return { file: candidate, unavailable: "write text was not available in one supported field" };
  if (Buffer.byteLength(values[0], "utf8") > maxTextBytes) return { file: candidate, unavailable: "new text exceeds scan limit" };
  return { file: candidate, value: values[0] };
}

const patchTools = new Set(["apply_patch", "patch"]);

type PatchChunk = { readonly before: readonly string[]; readonly after: readonly string[] };
type PatchFile = {
  readonly kind: "add" | "update";
  readonly file: string;
  readonly moveTo?: string;
  readonly contents: string;
  readonly chunks: readonly PatchChunk[];
  readonly added: readonly string[];
};

function patchTextOf(input: ToolGuardRequest): string | undefined {
  if (!patchTools.has(input.tool) || !isRecord(input.args)) return undefined;
  const value = input.args.patchText;
  return typeof value === "string" ? value : undefined;
}

// Reads the apply_patch envelope: `*** Add File:` bodies are `+` lines, `*** Update File:` carries an optional
// `*** Move to:` and `@@` chunks of ` `, `-` and `+` lines. Delete hunks remove text and are not scanned.
function parsePatch(patchText: string): readonly PatchFile[] {
  const lines = patchText.split(/\r?\n/u);
  const begin = lines.findIndex((line) => line.trim() === "*** Begin Patch");
  const end = lines.findIndex((line) => line.trim() === "*** End Patch");
  if (begin < 0 || end < 0 || begin >= end) throw new Error("patch text has no Begin/End markers");
  const isHeader = (line: string) => /^\*\*\* (?:Add|Update|Delete) File:/u.test(line);
  const files: PatchFile[] = [];
  let index = begin + 1;
  while (index < end) {
    const line = lines[index];
    if (line.startsWith("*** Add File:")) {
      const body: string[] = [];
      index += 1;
      while (index < end && !isHeader(lines[index])) {
        if (lines[index].startsWith("+")) body.push(lines[index].slice(1));
        index += 1;
      }
      files.push({ kind: "add", file: line.slice(13).trim(), contents: body.join("\n"), chunks: [], added: body });
    } else if (line.startsWith("*** Update File:")) {
      const file = line.slice(16).trim();
      let moveTo: string | undefined;
      index += 1;
      if (index < end && lines[index].startsWith("*** Move to:")) {
        moveTo = lines[index].slice(12).trim();
        index += 1;
      }
      const chunks: PatchChunk[] = [];
      const added: string[] = [];
      let before: string[] = [];
      let after: string[] = [];
      let open = false;
      const close = () => {
        if (open) chunks.push({ before, after });
        before = [];
        after = [];
        open = false;
      };
      while (index < end && !isHeader(lines[index])) {
        const row = lines[index];
        if (row.startsWith("@@")) close();
        else if (row.startsWith("*** End of File")) { /* marker only */ }
        else if (row.startsWith("+")) { open = true; after.push(row.slice(1)); added.push(row.slice(1)); }
        else if (row.startsWith("-")) { open = true; before.push(row.slice(1)); }
        else { open = true; const text = row.startsWith(" ") ? row.slice(1) : row; before.push(text); after.push(text); }
        index += 1;
      }
      close();
      files.push({ kind: "update", file, moveTo: moveTo === "" ? undefined : moveTo, contents: "", chunks, added });
    } else {
      index += 1;
    }
  }
  return files;
}

function applyChunks(oldText: string, chunks: readonly PatchChunk[]): string {
  const lines = oldText.split("\n");
  const trailing = lines.length > 1 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  let cursor = 0;
  for (const chunk of chunks) {
    if (chunk.before.length === 0) {
      lines.push(...chunk.after);
      cursor = lines.length;
      continue;
    }
    const matches = (at: number, normalize: (text: string) => string) =>
      chunk.before.every((text, offset) => at + offset < lines.length && normalize(lines[at + offset]) === normalize(text));
    let found = -1;
    for (const normalize of [(text: string) => text, (text: string) => text.trimEnd(), (text: string) => text.trim()]) {
      for (let at = cursor; at + chunk.before.length <= lines.length && found < 0; at += 1) {
        if (matches(at, normalize)) found = at;
      }
      if (found >= 0) break;
    }
    if (found < 0) throw new Error("patch chunk was not found in the current file");
    lines.splice(found, chunk.before.length, ...chunk.after);
    cursor = found + chunk.after.length;
  }
  return lines.join("\n") + (trailing ? "\n" : "");
}

function runJsonProcess(command: string, args: readonly string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    const finish = (error?: Error, value = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("output limit exceeded"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (timedOut) {
        finish(new Error(`timeout after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        finish(new Error(Buffer.concat(stderr).toString("utf8").trim() || `process exited ${String(code)}`));
        return;
      }
      finish(undefined, Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(input, "utf8");
  });
}

async function defaultScan(request: HumanizerScanRequest, timeoutMs: number): Promise<readonly HumanizerFinding[]> {
  // Inside OpenCode, process.execPath is the Bun host binary, which cannot run the worker script.
  const raw = await runJsonProcess(childNodeExecutable(), [detectorWorker], JSON.stringify(request), timeoutMs);
  const parsed = JSON.parse(raw) as WorkerOutput;
  if (!Array.isArray(parsed.findings)) throw new Error("detector returned an invalid response");
  return parsed.findings;
}

async function existingText(projectRoot: string, file: string): Promise<string> {
  const absolute = path.resolve(projectRoot, file);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("existing target is not a regular file");
    if (stat.size > maxTextBytes) throw new Error("existing target exceeds scan limit");
    return await fs.readFile(absolute, "utf8");
  } catch (error) {
    if (isMissing(error)) return "";
    throw error;
  }
}

function applyEdit(oldText: string, oldString: unknown, newString: string, replaceAll: unknown): string {
  if (typeof oldString !== "string" || oldString.length === 0) throw new Error("edit has no usable oldString");
  const index = oldText.indexOf(oldString);
  if (index < 0) throw new Error("edit oldString was not found in the current file");
  if (replaceAll === true) return oldText.split(oldString).join(newString);
  if (oldText.indexOf(oldString, index + oldString.length) >= 0) {
    throw new Error("edit oldString is ambiguous; exact changed text was not verified");
  }
  return oldText.slice(0, index) + newString + oldText.slice(index + oldString.length);
}

function remember(pending: Map<string, PendingNotice>, callID: string, notice: PendingNotice): void {
  if (pending.size >= maxPendingCalls) pending.delete(pending.keys().next().value as string);
  pending.set(callID, notice);
}

function addNotice(output: ToolGuardAfterOutput, message: string, tier: "block" | PendingNotice["tier"], findings = 0): void {
  output.output = output.output.trim() === "" ? message : `${output.output}\n\n${message}`;
  output.metadata = {
    ...output.metadata,
    litopencodeHumanizerGuard: { tier, findings }
  };
}

async function extractText(file: string, timeoutMs: number): Promise<string> {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".docx" || extension === ".pptx") {
    return runJsonProcess("python3", [officeExtractor, file], "", timeoutMs);
  }
  return runJsonProcess("pdftotext", ["-layout", file, "-"], "", timeoutMs);
}

function findOfficePaths(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const matches = value.match(/(?:^|[\s"'`=])((?:[A-Za-z]:)?(?:[\\/\w.@+-]+[\\/])?[\w.@+-]+\.(?:docx|pptx|pdf))(?=$|[\s"'`,;])/giu) ?? [];
    return matches.map((match) => match.trim().replace(/^[\s"'`=]+|["'`,;]+$/gu, ""));
  }
  if (Array.isArray(value)) return value.slice(0, 100).flatMap((item) => findOfficePaths(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).slice(0, 100).flatMap((item) => findOfficePaths(item, depth + 1));
}

function officeCandidates(input: ToolGuardRequest): readonly string[] {
  const paths = [...mutatedFilePaths(input.args), ...findOfficePaths(input.args)];
  return [...new Set(paths.filter((file) => officeExtensions.has(path.extname(file).toLowerCase()) && !isInternalPath(file)))].slice(0, 8);
}

export function createDeliverableHedgeGuard(options: DeliverableHedgeGuardOptions): DeliverableHedgeGuardState {
  const projectRoot = path.resolve(options.projectRoot);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const scan = options.scan ?? ((request: HumanizerScanRequest) => defaultScan(request, timeoutMs));
  const pending = new Map<string, PendingNotice>();

  async function scanTarget(file: string, oldText: string, newText: string): Promise<number> {
    if (Buffer.byteLength(newText, "utf8") > maxTextBytes) throw new Error("new text exceeds scan limit");
    const findings = await scan({ file, oldText, newText });
    const block = findings.filter((finding) => finding.severity === "block");
    if (block.length > 0) {
      const first = block[0];
      throw new Error(`LIT_HUMANIZER_BLOCKED rule=${first.rule} line=${first.line} path=${displayPath(file)}. Revise the new text before saving.`);
    }
    return findings.length;
  }

  // An apply_patch call can add several files; each deliverable-path target gets the same per-file scan as write
  // and edit. A chunk that cannot be located in the current file is scanned as appended text instead, so an added
  // pledge is still refused (the host rejects a patch whose context does not match, so nothing is saved either way).
  async function guardPatch(callID: string, patchText: string): Promise<void> {
    try {
      if (Buffer.byteLength(patchText, "utf8") > maxTextBytes) throw new Error("patch text exceeds scan limit");
      let warned = 0;
      let warnedFile = "";
      for (const entry of parsePatch(patchText)) {
        const target = entry.moveTo ?? entry.file;
        if (isInternalPath(target) || !readerFacingExtensions.has(path.extname(target).toLowerCase())) continue;
        const oldText = await existingText(projectRoot, entry.kind === "add" ? target : entry.file);
        let newText: string;
        if (entry.kind === "add") newText = entry.contents;
        else {
          try {
            newText = applyChunks(oldText, entry.chunks);
          } catch {
            newText = `${oldText}\n${entry.added.join("\n")}`;
          }
        }
        const count = await scanTarget(target, oldText, newText);
        if (count > 0 && warned === 0) warnedFile = target;
        warned += count;
      }
      if (warned > 0) {
        remember(pending, callID, {
          tier: "warn",
          message: `LIT_HUMANIZER_WARN findings=${warned} path=${displayPath(warnedFile)}. Review the new wording; keep any accurate, useful warning.`
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("LIT_HUMANIZER_BLOCKED")) throw error;
      remember(pending, callID, {
        tier: "unavailable",
        message: `LIT_HUMANIZER_GUARD_UNAVAILABLE: ${oneLine(error)}; write allowed without this check.`
      });
    }
  }

  return {
    async before(input) {
      const patchText = patchTextOf(input);
      if (patchText !== undefined) {
        pending.delete(input.callID);
        await guardPatch(input.callID, patchText);
        return;
      }
      const text = toolText(input);
      if (text === undefined) return;
      pending.delete(input.callID);
      if (text.unavailable !== undefined) {
        remember(pending, input.callID, {
          tier: "unavailable",
          message: `LIT_HUMANIZER_GUARD_UNAVAILABLE: ${text.unavailable}; write allowed without this check.`
        });
        return;
      }
      try {
        const oldText = await existingText(projectRoot, text.file);
        const newText = input.tool === "write"
          ? text.value ?? ""
          : applyEdit(oldText, (input.args as ToolRecord).oldString ?? (input.args as ToolRecord).old_string, text.value ?? "",
            (input.args as ToolRecord).replaceAll);
        const warned = await scanTarget(text.file, oldText, newText);
        if (warned > 0) {
          remember(pending, input.callID, {
            tier: "warn",
            message: `LIT_HUMANIZER_WARN findings=${warned} path=${displayPath(text.file)}. Review the new wording; keep any accurate, useful warning.`
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("LIT_HUMANIZER_BLOCKED")) throw error;
        remember(pending, input.callID, {
          tier: "unavailable",
          message: `LIT_HUMANIZER_GUARD_UNAVAILABLE: ${oneLine(error)}; write allowed without this check.`
        });
      }
    },
    async after(input, output) {
      const notice = pending.get(input.callID);
      pending.delete(input.callID);
      if (notice !== undefined) addNotice(output, notice.message, notice.tier);

      for (const candidate of officeCandidates(input)) {
        const file = path.resolve(projectRoot, candidate);
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size > maxTextBytes) throw new Error("artifact is not a bounded regular file");
          const text = await extractText(file, timeoutMs);
          const findings = await scan({ file: candidate, oldText: "", newText: text });
          if (findings.length === 0) continue;
          const blocks = findings.filter((finding) => finding.severity === "block");
          const tier = blocks.length > 0 ? "block" : "warn";
          const message = `LIT_HUMANIZER_OFFICE_${tier.toUpperCase()}_HIT findings=${findings.length} path=${displayPath(candidate)}. Fix the source and rebuild the document before presenting it.`;
          addNotice(output, message, tier, findings.length);
        } catch (error) {
          const message = path.extname(candidate).toLowerCase() === ".pdf" && oneLine(error).includes("ENOENT")
            ? "LIT_HUMANIZER_PDF_EXTRACTION_UNAVAILABLE: pdftotext is not installed; PDF text was not scanned."
            : `LIT_HUMANIZER_GUARD_UNAVAILABLE: ${oneLine(error)}; artifact text was not checked.`;
          addNotice(output, message, "unavailable");
        }
      }
    },
    dispose() {
      pending.clear();
    }
  };
}
