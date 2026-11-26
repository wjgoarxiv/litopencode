// `install --round`: one pinned, symbols-only icon font in the user's own font folder, for the round ends of the
// pills. It is added only when no icon font is here, under names nothing else holds, and `icon-font remove` takes
// back exactly the files it added. Whatever goes wrong comes back as a short reason; the install itself goes on.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fontFolders, iconFontInstalled } from "../round-glyphs.ts";
import { ensurePrivateStateRoot } from "./auto-update.ts";
import { execCommand } from "./command-plan.ts";
import { homePath } from "./install-cards.ts";
import { isRecord } from "./json.ts";

type FontPins = {
  readonly url: string;
  readonly archiveSha256: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly files: readonly { readonly entry: string; readonly name: string; readonly sha256: string }[];
};

export const iconFontPins: FontPins = {
  url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip",
  archiveSha256: "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc",
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 60_000,
  files: [
    { entry: "SymbolsNerdFontMono-Regular.ttf", name: "SymbolsNerdFontMono-Regular.ttf", sha256: "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749" },
    { entry: "LICENSE", name: "SymbolsNerdFontMono-LICENSE.txt", sha256: "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847" }
  ]
};

/** A local copy of the pinned archive, for a machine without a network and for the tests. */
const archiveEnv = "LITOPENCODE_ICON_FONT_ARCHIVE";
const manifestName = "icon-font.json";

type Env = Readonly<Record<string, string | undefined>>;
export type IconFontInput = {
  readonly env?: Env;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  readonly pins?: FontPins;
  readonly fetch?: (url: string, options: { readonly signal: AbortSignal; readonly redirect: "follow" }) => Promise<Response>;
  readonly refresh?: (folder: string) => Promise<void>;
  /** The folders searched for an icon font; the platform's own when not given. */
  readonly systemFolders?: readonly string[];
};
export type IconFontPlan = { readonly state: "present" | "add" | "unsupported"; readonly folder?: string; readonly files?: readonly string[] };
export type IconFontResult =
  | { readonly state: "added"; readonly folder: string; readonly files: readonly string[] }
  | { readonly state: "present" | "unsupported" }
  | { readonly state: "failed"; readonly reason: string };

class FontProblem extends Error {}

const isCode = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException | undefined)?.code === code;
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function settings(input: IconFontInput) {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? os.homedir();
  const data = env.XDG_DATA_HOME;
  const [base, below] = platform === "darwin"
    ? [homeDir, ["Library", "Fonts"]]
    : data !== undefined && path.isAbsolute(data) ? [data, ["fonts"]] : [homeDir, [".local", "share", "fonts"]];
  const folder = path.join(base, ...below);
  const searched = [folder, ...(input.systemFolders ?? fontFolders({ ...env, HOME: homeDir }, platform))];
  return { env, platform, homeDir, base, below, folder, searched, pins: input.pins ?? iconFontPins };
}

/** What `--round` would do; looks at file names only. */
export function planIconFont(input: IconFontInput = {}): IconFontPlan {
  const { platform, folder, searched, pins } = settings(input);
  if (platform === "win32") return { state: "unsupported" };
  return iconFontInstalled(searched) ? { state: "present" } : { state: "add", folder, files: pins.files.map(({ name }) => name) };
}

/** The entry's bytes, from a zip's central directory; stored and deflated entries only. */
function zipEntry(zip: Buffer, name: string, maxBytes: number): Buffer {
  const end = zip.lastIndexOf(Buffer.from("PK\u0005\u0006", "latin1"));
  let at = zip.readUInt32LE(end + 16);
  for (let left = zip.readUInt16LE(end + 10); left > 0; left -= 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) break;
    const nameLength = zip.readUInt16LE(at + 28);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(at + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + zip.readUInt32LE(at + 20));
      const method = zip.readUInt16LE(at + 10);
      if (method === 0) return body;
      if (method === 8) return inflateRawSync(body, { maxOutputLength: maxBytes });
      break;
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error("no such entry");
}

function readLocalArchive(file: string, maxBytes: number): Buffer {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new FontProblem("archive unreadable");
    if (stat.size > maxBytes) throw new FontProblem("archive too large");
    return fs.readFileSync(file);
  } catch (error) {
    throw error instanceof FontProblem ? error : new FontProblem("archive unreadable");
  }
}

async function downloadArchive(pins: FontPins, get: NonNullable<IconFontInput["fetch"]>): Promise<Buffer> {
  const signal = AbortSignal.timeout(pins.timeoutMs);
  try {
    const response = await get(pins.url, { signal, redirect: "follow" });
    if (!response.ok || response.body === null) throw new FontProblem("download failed");
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > pins.maxBytes) throw new FontProblem("archive too large");
      parts.push(part);
    }
    return Buffer.concat(parts);
  } catch (error) {
    if (error instanceof FontProblem) throw error;
    throw new FontProblem(signal.aborted ? "download timed out" : "download failed");
  }
}

function unpack(archive: Buffer, pins: FontPins): readonly { readonly name: string; readonly sha256: string; readonly bytes: Buffer }[] {
  if (digest(archive) !== pins.archiveSha256) throw new FontProblem("checksum differs");
  return pins.files.map(({ entry, name, sha256 }) => {
    let bytes: Buffer;
    try {
      bytes = zipEntry(archive, entry, pins.maxBytes);
    } catch {
      throw new FontProblem("archive unreadable");
    }
    if (digest(bytes) !== sha256) throw new FontProblem("checksum differs");
    return { name, sha256, bytes };
  });
}

/** Makes the font folder; a link on the way there is refused, since it may lead anywhere. */
function openFontFolder(base: string, below: readonly string[]): void {
  fs.mkdirSync(base, { recursive: true });
  let at = base;
  for (const part of below) {
    at = path.join(at, part);
    try {
      fs.mkdirSync(at);
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
    if (!fs.lstatSync(at).isDirectory()) throw new FontProblem("font folder is a link");
  }
}

/** Claims `name` with a hard link, which fails when anything holds that name. True when this call made the file. */
function claim(folder: string, name: string, bytes: Buffer): boolean {
  const target = path.join(folder, name);
  const staging = path.join(folder, `.${name}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(staging, bytes, { flag: "wx", mode: 0o644 });
    fs.linkSync(staging, target);
    return true;
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    if (fs.lstatSync(target).isFile() && digest(fs.readFileSync(target)) === digest(bytes)) return false;
    throw new FontProblem("that name is taken");
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

type OwnedFile = { readonly path: string; readonly sha256: string };

function readOwned(manifest: string): readonly OwnedFile[] {
  try {
    if (!fs.lstatSync(manifest).isFile()) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) return [];
    return parsed.files.filter((file): file is OwnedFile => isRecord(file) && typeof file.path === "string" && typeof file.sha256 === "string");
  } catch {
    return [];
  }
}

function writeOwned(manifest: string, files: readonly OwnedFile[]): void {
  const staging = `${manifest}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(staging, JSON.stringify({ version: 1, files }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(staging, manifest);
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

/** Desktop Linux finds a new font only after its cache is rebuilt; a machine without fc-cache needs nothing. */
async function rebuildFontCache(folder: string): Promise<void> {
  await execCommand("fc-cache", ["-f", folder], { timeout: 20_000 }).catch(() => undefined);
}

export async function addIconFont(input: IconFontInput = {}): Promise<IconFontResult> {
  const plan = planIconFont(input);
  if (plan.state !== "add") return { state: plan.state };
  const { env, platform, homeDir, base, below, folder, pins } = settings(input);
  const made: string[] = [];
  try {
    const local = env[archiveEnv];
    const archive = local !== undefined && local !== "" ? readLocalArchive(local, pins.maxBytes) : await downloadArchive(pins, input.fetch ?? fetch);
    const files = unpack(archive, pins);
    const manifest = path.join(await ensurePrivateStateRoot(homeDir), manifestName);
    openFontFolder(base, below);
    for (const { name, bytes } of files) if (claim(folder, name, bytes)) made.push(path.join(folder, name));
    const owned = new Map(readOwned(manifest).map((file) => [file.path, file]));
    for (const { name, sha256 } of files) {
      const file = path.join(folder, name);
      if (made.includes(file)) owned.set(file, { path: file, sha256 });
    }
    writeOwned(manifest, [...owned.values()]);
  } catch (error) {
    for (const file of made) fs.rmSync(file, { force: true });
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return { state: "failed", reason: error instanceof FontProblem ? error.message : `folder refused${code === undefined ? "" : `, ${code}`}` };
  }
  if (platform !== "darwin") await (input.refresh ?? rebuildFontCache)(folder);
  return { state: "added", folder, files: pins.files.map(({ name }) => name) };
}

export function iconFontLine(result: IconFontResult): string {
  if (result.state === "added") return `ICON_FONT: added ${result.files[0]} in ${homePath(result.folder)}`;
  if (result.state === "present") return "ICON_FONT: an icon font is already here, so nothing was added";
  return `ICON_FONT: ${result.state === "failed" ? `not installed (${result.reason})` : "none needed, Windows Terminal and VS Code draw the ends"}`;
}

/** Takes back the files `--round` added, as long as they still hold the bytes it wrote. */
export async function removeIconFont(input: IconFontInput & { readonly dryRun?: boolean } = {}): Promise<{ readonly removed: readonly string[]; readonly kept: readonly string[]; readonly line: string }> {
  const { platform, homeDir } = settings(input);
  const manifest = path.join(homeDir, ".litopencode", manifestName);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const file of readOwned(manifest)) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file.path);
    } catch {
      continue;
    }
    if (!stat.isFile() || digest(fs.readFileSync(file.path)) !== file.sha256) {
      kept.push(file.path);
      continue;
    }
    if (input.dryRun !== true) fs.unlinkSync(file.path);
    removed.push(file.path);
  }
  if (input.dryRun !== true) {
    fs.rmSync(manifest, { force: true });
    if (removed.length > 0 && platform !== "darwin") await (input.refresh ?? rebuildFontCache)(path.dirname(removed[0]));
  }
  const lines = removed.length === 0
    ? ["ICON_FONT: nothing to remove"]
    : [`ICON_FONT: ${input.dryRun === true ? "would remove" : "removed"} ${removed.map(homePath).join(", ")}`, "Your other products may then draw square ends."];
  return { removed, kept, line: [...lines, ...kept.map((file) => `ICON_FONT: kept ${homePath(file)}, changed since it was added`)].join("\n") };
}
