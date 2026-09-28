import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

// lit-typographic-motion's look rounds count a frame as viewed only when OpenCode's read tool opened
// it. This hook sees every completed read; when the file is a PNG inside a film's output directory
// (one holding treatment.json and a stills set), it appends the file and its SHA-256 to that
// directory's .run/image-reads.jsonl. It never reads tool output, never throws and writes nowhere else.
const maxLevels = 3;

export type MotionImageReadInput = { readonly tool: string; readonly args?: unknown };

function filePathOf(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>).filePath ?? (args as Record<string, unknown>).file_path ?? (args as Record<string, unknown>).path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function motionRunDirFor(file: string): string | undefined {
  let dir = path.dirname(file);
  for (let level = 0; level <= maxLevels; level++) {
    if (existsSync(path.join(dir, "treatment.json")) && existsSync(path.join(dir, "stills", "stills.json")) && existsSync(path.join(dir, ".run"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function recordMotionImageRead(input: MotionImageReadInput, cwd: string = process.cwd()): void {
  if (input.tool !== "read") return;
  const raw = filePathOf(input.args);
  if (raw === undefined || !/\.png$/iu.test(raw)) return;
  try {
    const file = path.resolve(cwd, raw);
    if (!existsSync(file)) return;
    const runDir = motionRunDirFor(file);
    if (runDir === undefined) return;
    const record = { file: path.relative(runDir, file).split(path.sep).join("/"), sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), tool: "read", at: new Date().toISOString() };
    appendFileSync(path.join(runDir, ".run", "image-reads.jsonl"), `${JSON.stringify(record)}\n`);
  } catch {
    // A failed record only means the done check will ask for the read again.
  }
}
