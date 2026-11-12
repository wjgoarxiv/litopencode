import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareStableVersions } from "./cli/update-notifier.ts";
import { movedSkillFamilies, wjgoarxivSkillsClonePlaceholder } from "./moved-skills.ts";

// The file-making skills became LitFamily extensions, kept in wjgoarxiv-skills. The installer prints this notice
// as it runs and leaves the same text in the OpenCode config root; the first root session after that takes the
// file and relays the notice once. Machine-readable output never carries it.
export const extensionsShelfUrl = "https://github.com/wjgoarxiv/wjgoarxiv-skills";
export const pendingExtensionsNoticeName = ".litopencode-extensions-notice";
const pendingCapBytes = 8192;

// Prose wraps at 78 columns to fit an 80-column terminal; command lines are written to fit on their own.
function wrap(text: string, width = 78): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current !== "" && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

export function extensionsNoticeLines(leftovers: readonly string[] = []): string[] {
  return [
    "LitFamily extensions",
    ...wrap(
      "LitOpenCode's core is complete and works on its own. Nine skills that make files (decks, documents, " +
        `figures, design and video covers) are now LitFamily extensions, kept on the extension shelf at ${extensionsShelfUrl}. ` +
        "Install the ones you use alongside LitOpenCode to get the full LitFamily experience. " +
        "Clone the shelf once, then for each skill you want:"
    ),
    "  rm -r ~/.config/opencode/skills/<skill>",
    `  cp -R "${wjgoarxivSkillsClonePlaceholder}/variants/litopencode/<skill>" \\`,
    "    ~/.config/opencode/skills/<skill>",
    ...wrap(`The nine: ${Object.keys(movedSkillFamilies).join(", ")}.`),
    ...(leftovers.length === 0
      ? []
      : [
          ...wrap("Your previous LitOpenCode left these behind. Nothing reads them now and the extensions keep their own, so you can delete them:"),
          ...leftovers.map((leftover) => `  ${leftover}`)
        ])
  ];
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(candidate);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Caches an earlier LitOpenCode left that this version no longer reads, by absolute path. */
export async function previousVersionLeftovers(
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const cacheHome = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0
    ? env.XDG_CACHE_HOME
    : path.join(env.HOME && env.HOME.length > 0 ? env.HOME : os.homedir(), ".cache");
  const found: string[] = [];
  for (const name of ["motion-runtime", "office"]) {
    const candidate = path.join(cacheHome, "litopencode", name);
    if (await isDirectory(candidate)) found.push(candidate);
  }
  // OpenCode keeps one folder per plugin version it fetched; only the current one is still in use. A long run of
  // old versions is named as one pattern so the notice stays short.
  const packages = path.join(cacheHome, "opencode", "packages", "@litfamily");
  const old: string[] = [];
  for (const entry of await fs.readdir(packages).catch(() => [] as string[])) {
    const version = entry.startsWith("litopencode@") ? entry.slice("litopencode@".length) : undefined;
    if (version === undefined || version === currentVersion) continue;
    if (await isDirectory(path.join(packages, entry))) old.push(version);
  }
  old.sort((left, right) => compareStableVersions(left, right) ?? left.localeCompare(right));
  if (old.length <= 2) found.push(...old.map((version) => path.join(packages, `litopencode@${version}`)));
  else found.push(`${path.join(packages, "litopencode@")}<version>\n    (${old.length} old versions, ${old[0]} to ${old[old.length - 1]})`);
  return found;
}

/** Leaves the notice for the next session. Best effort: a root that cannot take it loses the notice, never the install. */
export async function writePendingExtensionsNotice(root: string, text: string): Promise<void> {
  const file = path.join(root, pendingExtensionsNoticeName);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const existing = await fs.lstat(file).catch(() => undefined);
    if (existing !== undefined && !existing.isFile()) return;
    await fs.writeFile(temp, `${text}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temp, file);
  } catch {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

/** Takes the pending notice exactly once across sessions and returns the text for the model, or undefined. */
export async function takePendingExtensionsNotice(root: string): Promise<string | undefined> {
  const file = path.join(root, pendingExtensionsNoticeName);
  const taken = `${file}.${process.pid}.${randomUUID()}.taken`;
  try {
    if (!(await fs.lstat(file)).isFile()) return undefined;
    await fs.rename(file, taken);
  } catch {
    return undefined;
  }
  try {
    const handle = await fs.open(taken, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(pendingCapBytes);
      const { bytesRead } = await handle.read(buffer, 0, pendingCapBytes, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8").trim();
    } finally {
      await handle.close();
    }
    if (text === "") return undefined;
    return [
      "LitOpenCode was just installed or updated, and this is the first session since. Show the user the notice below",
      "once, before your answer to this message, in the language of their message. Keep the URL, commands and paths",
      "exactly as written, run none of them, then answer the message as usual.",
      "",
      text
    ].join("\n");
  } catch {
    return undefined;
  } finally {
    await fs.rm(taken, { force: true }).catch(() => undefined);
  }
}
