// The way a server-side popup reaches the screen on OpenCode 2. The server plugin's context only subscribes to
// events, so it cannot raise a toast; the TUI plugin can, but it knows nothing of the server's state machines
// (the automatic handoff). The server therefore appends each popup it would have shown to a small file under
// the project's .litopencode, and the TUI reads the lines that appear after it started and toasts them. Both
// halves ship in this package; neither needs the other to be there. A symbolic link in place of the file is
// never followed, a torn line waits for its newline, and the file is rewritten to its newest lines past a cap.
import fs from "node:fs";
import path from "node:path";

export type NoticeVariant = "info" | "success" | "warning" | "error";
export type TuiNotice = { readonly title: string; readonly message: string; readonly variant: NoticeVariant; readonly duration: number };
type Stored = TuiNotice & { readonly id: string; readonly at: number };

const variants: ReadonlySet<string> = new Set(["info", "success", "warning", "error"]);
const titleCells = 80;
const messageCells = 400;
const minDuration = 1000;
const maxDuration = 15_000;
const defaultDuration = 8000;
const capBytes = 64_000;
const keepBytes = 24_000;
const readCapBytes = 128_000;
const seenLimit = 64;

let counter = 0;

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}

function clean(value: unknown): TuiNotice | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.title !== "string" || typeof entry.message !== "string" || entry.message === "") return undefined;
  if (typeof entry.variant !== "string" || !variants.has(entry.variant)) return undefined;
  const duration = typeof entry.duration === "number" && Number.isFinite(entry.duration) ? Math.min(maxDuration, Math.max(minDuration, entry.duration)) : defaultDuration;
  return { title: clip(entry.title, titleCells), message: clip(entry.message, messageCells), variant: entry.variant as NoticeVariant, duration };
}

function plainFile(file: string): fs.Stats | undefined {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() ? stat : undefined;
  } catch {
    return undefined;
  }
}

function trimToNewest(file: string): void {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n").filter((line) => line !== "");
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    size += Buffer.byteLength(lines[index]) + 1;
    if (size > keepBytes) break;
    kept.unshift(lines[index]);
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, kept.length === 0 ? "" : `${kept.join("\n")}\n`);
  fs.renameSync(temp, file);
}

/** Leaves one popup for the TUI. Best effort: a place that cannot be written loses the notice, never the caller. */
export function appendNotice(file: string, notice: TuiNotice): void {
  const cleaned = clean(notice);
  if (cleaned === undefined) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = (() => {
      try {
        return fs.lstatSync(file);
      } catch {
        return undefined;
      }
    })();
    if (existing !== undefined && !existing.isFile()) return;
    counter += 1;
    const stored: Stored = { id: `${Date.now().toString(36)}-${process.pid}-${counter}`, at: Date.now(), ...cleaned };
    fs.appendFileSync(file, `${JSON.stringify(stored)}\n`);
    if ((plainFile(file)?.size ?? 0) > capBytes) trimToNewest(file);
  } catch { // no-excuse-ok: catch -- a popup is best-effort feedback; the handoff itself must never stop for it.
  }
}

/** Reads the notices that appear after it was made. Each call returns the new ones once, oldest first. */
export function createNoticeTail(file: string): { readonly poll: () => readonly TuiNotice[] } {
  let offset = plainFile(file)?.size ?? 0;
  const seen: string[] = [];

  return {
    poll() {
      const stat = plainFile(file);
      if (stat === undefined) return [];
      // A smaller file was rewritten to its newest lines; read it again and let the ids drop what was shown.
      if (stat.size < offset) offset = 0;
      if (stat.size === offset) return [];
      const length = Math.min(stat.size - offset, readCapBytes);
      const buffer = Buffer.alloc(length);
      let fd: number | undefined;
      try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        fs.readSync(fd, buffer, 0, length, offset);
      } catch {
        return [];
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      const text = buffer.toString("utf8");
      const end = text.lastIndexOf("\n");
      if (end < 0) return length === readCapBytes ? (offset += length, []) : [];
      offset += Buffer.byteLength(text.slice(0, end + 1));
      const out: TuiNotice[] = [];
      for (const line of text.slice(0, end).split("\n")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const id = typeof (parsed as { id?: unknown } | null)?.id === "string" ? (parsed as { id: string }).id : undefined;
        if (id !== undefined && seen.includes(id)) continue;
        const entry = clean(parsed);
        if (entry === undefined) continue;
        if (id !== undefined) {
          seen.push(id);
          if (seen.length > seenLimit) seen.shift();
        }
        out.push(entry);
      }
      return out;
    }
  };
}
