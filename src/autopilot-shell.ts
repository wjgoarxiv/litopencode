// The shell-call guard of an autopilot start-work run. It reads a command with its own small word
// parser (no shell is ever asked to interpret it) and returns one verdict:
//   allow   a reader, the plan's Done-when check, `node <script>` under an execute grant, or a
//           charter commit; the call runs now.
//   refuse  secrets, settings, real host homes, `.git` internals, a bare `cd`; never stored.
//   split   a self-check refused only for its shape (`;`, `||`, `echo`, `$?`); each part may run alone.
//   park    everything else, recorded for the user's answer. Tier B is an allowlist of local,
//           undoable verbs whose every path stays inside the project; all other parked calls are X.
//           A parked call the parser cannot follow carries `hold` and is never replayed.
// The protected-path decision is shared with the run's file-tool guard (run-paths.ts), so a secret that
// a direct read refuses is refused here too, whatever the grants say.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyRunPath, defaultRunPathContext } from "./run-paths.ts";

export type ShellGrant = { readonly action: "read" | "write" | "execute"; readonly root: string };

export type ShellCharter = { readonly branch: string; readonly repo: string };

export type ShellContext = {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly grants: readonly ShellGrant[];
  readonly doneCheck?: string;
  /** Present only while the charter is bound to the run's consent. */
  readonly charter?: ShellCharter;
  /** Folders of this host session that may always be read (S-A2-10). */
  readonly ownFolders?: readonly string[];
  /** Other protected roots (the run's own state), compared after links resolve. */
  readonly protectedRoots?: readonly string[];
};

export type ShellVerdict =
  | { readonly kind: "allow"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string }
  | { readonly kind: "split"; readonly parts: readonly string[] }
  | { readonly kind: "park"; readonly tier: "B" | "X"; readonly reason: string; readonly outward: boolean; readonly hold?: string };

type WordFlag = "dollar" | "backtick" | "backslash" | "glob" | "brace" | "tilde";
type Word = { readonly kind: "word"; readonly text: string; readonly flags: ReadonlySet<WordFlag> };
type Op = { readonly kind: "op"; readonly text: string };
type Token = Word | Op;

type Lexed = { readonly tokens: readonly Token[]; readonly problem?: string };

const allowedRedirects = new Set(["2>&1", "2>/dev/null"]);

function lex(command: string): Lexed {
  const tokens: Token[] = [];
  let text = "";
  let started = false;
  let flags = new Set<WordFlag>();
  const flush = (): void => {
    if (started) tokens.push({ kind: "word", text, flags });
    text = "";
    started = false;
    flags = new Set();
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (char === " " || char === "\t") {
      flush();
      continue;
    }
    if (char === "\n" || char === "\r") {
      flush();
      tokens.push({ kind: "op", text: ";" });
      continue;
    }
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end < 0) return { tokens, problem: "quotes do not pair" };
      text += command.slice(index + 1, end);
      started = true;
      index = end;
      continue;
    }
    if (char === "\"") {
      let end = index + 1;
      for (; end < command.length && command[end] !== "\""; end += 1) {
        const inner = command[end];
        if (inner === "$") flags.add("dollar");
        if (inner === "`") flags.add("backtick");
        if (inner === "\\") flags.add("backslash");
      }
      if (end >= command.length) return { tokens, problem: "quotes do not pair" };
      text += command.slice(index + 1, end);
      started = true;
      index = end;
      continue;
    }
    if (char === "&" && next === "&") { flush(); tokens.push({ kind: "op", text: "&&" }); index += 1; continue; }
    if (char === "|" && next === "|") { flush(); tokens.push({ kind: "op", text: "||" }); index += 1; continue; }
    if (char === "|") { flush(); tokens.push({ kind: "op", text: next === "&" ? "|&" : "|" }); if (next === "&") index += 1; continue; }
    if (char === ";") { flush(); tokens.push({ kind: "op", text: ";" }); continue; }
    if (char === "(" || char === ")") { flush(); tokens.push({ kind: "op", text: char }); continue; }
    const redirect = /^(\d*)(>>|>&|&>|>|<<<|<<|<&|<)(&?\d+|\/dev\/null(?=[\s;&|]|$))?/u.exec(command.slice(index));
    if ((char === ">" || char === "<" || (char === "&" && next === ">") || (/\d/u.test(char) && !started && redirect !== null && redirect[1] !== "")) && redirect !== null) {
      flush();
      tokens.push({ kind: "op", text: redirect[0] });
      index += redirect[0].length - 1;
      continue;
    }
    if (char === "&") { flush(); tokens.push({ kind: "op", text: "&" }); continue; }
    if (char === "#" && !started) return { tokens, problem: "a shell comment is not read" };
    if (char === "$") flags.add("dollar");
    if (char === "`") flags.add("backtick");
    if (char === "\\") flags.add("backslash");
    if (char === "*" || char === "?" || char === "[") flags.add("glob");
    if (char === "{" || char === "}") flags.add("brace");
    if (char === "~" && !started) flags.add("tilde");
    text += char;
    started = true;
  }
  flush();
  return { tokens };
}

// ---------------------------------------------------------------------------------------------
// Protected material: refused before anything else, on the text with every quote removed.

const protectedMarkers: readonly RegExp[] = [
  /(?:^|[/=:])\.(?:ssh|aws|gnupg|gpg|npmrc|netrc|pypirc|envrc|docker|kube|azure|password-store)(?=$|\/)/iu,
  /(?:^|[/=:])\.env(?:\.(?!example$|sample$|template$)[\w-]+)?$/iu,
  /(?:^|[/=:])\.(?:bashrc|bash_profile|zshrc|zprofile|zshenv|profile|bash_login|login)$/iu,
  /(?:^|[/=:])(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:\.pub)?$/iu,
  /[^/]+\.(?:pem|p12|pfx|key)$/iu,
  /(?:^|[/=:])\.config\/(?:opencode|gh|gcloud|git\/credentials)(?=$|\/)/iu,
  /(?:^|[/=:])\.local\/(?:share|state)\/opencode(?=$|\/)/iu,
  /(?:^|[/=:])\.(?:claude|codex|hermes|grok)(?=$|\/)/iu,
  /(?:^|[/=:])\.mcp\.json$/iu,
  /(?:^|[/=:])(?:opencode\.jsonc?|litopencode\.json|tui\.json)$/iu,
  // The run's own state folder, and the git files that make git run code or change where it reads.
  /(?:^|[/=:])\.litopencode\/litgoal(?=$|\/)/iu,
  /(?:^|[/=:])\.git\/(?:hooks|config|info\/attributes)(?=$|\/)/iu,
  /(?:^|[/=:])\.litopencode\/goal(?=$|\/)/iu,
  /(?:^|[/=:])\.git-credentials$/iu
];

function realHomes(): readonly string[] {
  const homes = new Set<string>();
  try {
    homes.add(os.userInfo().homedir);
  } catch { // no-excuse-ok: catch -- an account without a passwd entry still has HOME below.
  }
  if (process.env.HOME) homes.add(process.env.HOME);
  return [...homes].filter((home) => home !== "" && home !== "/");
}

function foldCase(value: string): string {
  return process.platform === "darwin" || process.platform === "win32" ? value.toLowerCase() : value;
}

function containedIn(relative: string): boolean {
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function within(root: string, candidate: string): boolean {
  return containedIn(path.relative(foldCase(root), foldCase(candidate)));
}

/** The same test with letter case ignored on every OS: a state folder or `.git` spelled in another case is refused even on a case-sensitive disk. */
function withinAnyCase(root: string, candidate: string): boolean {
  return containedIn(path.relative(root.toLowerCase(), candidate.toLowerCase()));
}

/** Nearest-existing-parent realpath; `dangling` when a link on the way points nowhere. */
type Resolved = { readonly real: string; readonly exists: boolean; readonly dangling: boolean; readonly isDirectory: boolean; readonly loop?: boolean };

const linkHopLimit = 16;

/** Follows a link chain hop by hop (parents resolved as far as they exist); a chain past the hop limit is a loop. */
function linkChainEnd(start: string): { readonly target: string; readonly loop: boolean } {
  let current = start;
  for (let hop = 0; hop < linkHopLimit; hop += 1) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { target: current, loop: false };
      let realParent = parent;
      try {
        realParent = fs.realpathSync(parent);
      } catch {
        const up = linkChainEnd(parent);
        if (up.loop) return up;
        realParent = up.target;
      }
      return { target: path.join(realParent, path.basename(current)), loop: false };
    }
    if (!stat.isSymbolicLink()) return { target: current, loop: false };
    current = path.resolve(path.dirname(current), fs.readlinkSync(current));
  }
  return { target: current, loop: true };
}

export function resolveTarget(cwd: string, word: string): Resolved {
  const absolute = path.resolve(cwd, word);
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
      return { real: absolute, exists: true, dangling: true, isDirectory: false };
    }
  }
  if (stat !== undefined) {
    try {
      const real = fs.realpathSync(absolute);
      return { real, exists: true, dangling: false, isDirectory: fs.statSync(real).isDirectory() };
    } catch {
      // A dangling or looping chain: report where it ends, so the protected-path check sees the final target.
      const end = linkChainEnd(absolute);
      return { real: end.target, exists: true, dangling: true, isDirectory: false, loop: end.loop };
    }
  }
  const parent = path.dirname(absolute);
  if (parent === absolute) return { real: absolute, exists: false, dangling: false, isDirectory: false };
  const resolvedParent = resolveTarget(parent, ".");
  return {
    real: path.join(resolvedParent.real, path.basename(absolute)),
    exists: false,
    dangling: resolvedParent.dangling || (resolvedParent.exists && !resolvedParent.isDirectory),
    isDirectory: false
  };
}

/** Real host homes of OpenCode and of the other harnesses, plus the account's real home when HOME is replaced. */
function hostProtectedRoots(extra: readonly string[]): readonly string[] {
  const roots = new Set<string>(extra);
  for (const home of realHomes()) {
    for (const relative of [".config/opencode", ".local/share/opencode", ".local/state/opencode", ".cache/opencode", ".ssh", ".aws", ".gnupg", ".claude", ".codex", ".hermes", ".grok"]) {
      roots.add(path.join(home, relative));
    }
  }
  for (const variable of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    const value = process.env[variable];
    if (value) roots.add(path.join(value, "opencode"));
  }
  if (process.env.OPENCODE_CONFIG_DIR) roots.add(process.env.OPENCODE_CONFIG_DIR);
  const resolved = new Set<string>();
  for (const root of roots) {
    resolved.add(root);
    try {
      resolved.add(fs.realpathSync(root));
    } catch { // no-excuse-ok: catch -- a protected root that does not exist yet is still compared by its own path.
    }
  }
  return [...resolved];
}

function isOwnFolder(ctx: ShellContext, candidate: string): boolean {
  return (ctx.ownFolders ?? []).some((root) => within(root, candidate));
}

/** The project's git folders: `.git`, or for a worktree the gitdir its `.git` file names and that gitdir's common dir. */
function gitDirs(projectRoot: string): readonly string[] {
  const dotGit = path.join(projectRoot, ".git");
  const dirs = [dotGit];
  try {
    if (fs.statSync(dotGit).isFile()) {
      const named = /^gitdir:\s*(.+?)\s*$/mu.exec(fs.readFileSync(dotGit, "utf8"));
      if (named !== null) {
        const gitdir = path.resolve(projectRoot, named[1]);
        dirs.push(gitdir);
        try {
          dirs.push(path.resolve(gitdir, fs.readFileSync(path.join(gitdir, "commondir"), "utf8").trim()));
        } catch { // no-excuse-ok: catch -- a gitdir without a commondir file is its own common dir.
        }
      }
    }
  } catch { // no-excuse-ok: catch -- a project without .git has only the path itself to protect.
  }
  return dirs;
}

/** The run's own state folder and the git folders: a command that would remove, move or replace a folder holding them is refused. */
function stateHolders(ctx: ShellContext): readonly string[] {
  return [path.join(ctx.projectRoot, ".litopencode", "litgoal"), ...gitDirs(ctx.projectRoot), ...(ctx.protectedRoots ?? [])];
}

const commandStart = String.raw`(?:^|[;&|(]\s*)`;
const mutatingVerb = new RegExp(`${commandStart}(?:git\\s+(?:rm|mv|clean)|rm|rmdir|mv|cp|rsync|chmod|chown|chgrp|ln|unlink|truncate|shred|tar|install|ditto|trash)(?=\\s|$)|\\s-delete(?=\\s|$)`, "u");
const writingVerb = new RegExp(`${commandStart}(?:tee|touch|mkdir|dd|patch|truncate|sed\\s+(?:[^;&|]*\\s)?-[A-Za-z]*i)(?=\\s|$)`, "u");
// Only `cp -a` is recursive through `a`; `ls -a`/`grep -a`/`diff -a` are not, and `ls -r` only reverses.
const recursiveReader = new RegExp(`${commandStart}(?:rg|find|tree|du|ag)(?=\\s|$)|${commandStart}(?:grep|egrep|fgrep|zgrep|diff)\\s(?:[^;&|]*\\s)?-(?:[A-Za-z]*[rR]|-recursive|-dereference-recursive|d\\s*recurse|-directories=recurse)|${commandStart}ls\\s(?:[^;&|]*\\s)?-(?:[A-Za-z]*R|-recursive)|${commandStart}cp\\s(?:[^;&|]*\\s)?-(?:[A-Za-z]*[rRa]|-recursive|-archive)`, "u");

type PieceMode = { readonly mutating: boolean; readonly writing: boolean; readonly recursive: boolean };

function pieceReason(piece: string, cwd: string, ctx: ShellContext, roots: readonly string[], runCtx: ReturnType<typeof defaultRunPathContext>, mode: PieceMode): string | undefined {
  const expanded = piece.startsWith("~/") ? path.join(os.homedir(), piece.slice(2)) : piece === "~" ? os.homedir() : piece;
  const resolved = resolveTarget(cwd, expanded);
  if (resolved.loop === true) return "a link loop is refused";
  const candidate = resolved.real;
  const lexical = path.resolve(cwd, expanded);
  if ((mode.mutating || mode.writing) && gitDirs(ctx.projectRoot).some((dir) => within(dir, candidate) || within(dir, lexical))) {
    return "it writes inside the git folder, which only git itself may change";
  }
  // A read of this session's own host folders (tool output it was handed, its scratch) never parks.
  if (isOwnFolder(ctx, candidate) && isOwnFolder(ctx, lexical)) return undefined;
  if (classifyRunPath(expanded, runCtx, "read") === "harness-read") return undefined;
  if (protectedMarkers.some((pattern) => pattern.test(piece) || pattern.test(candidate) || pattern.test(lexical))) return "it names a secret, a settings file or a host home";
  if (classifyRunPath(expanded, runCtx, "write") === "protected") return "it names a secret, a settings file or a host home";
  if ((expanded.includes("/") || candidate !== lexical) && roots.some((root) => within(root, candidate) || within(root, lexical))) {
    return "it reaches a real host home or a protected folder";
  }
  if (mode.recursive && homeProtectedRoots().some((root) => within(candidate, root) || within(lexical, root))) {
    return "a recursive read of a folder that holds a host home or its secrets is refused";
  }
  return undefined;
}

/** The protected folders under the account's real homes; a recursive read above one of them is refused. */
function homeProtectedRoots(): readonly string[] {
  return realHomes().flatMap((home) => [".ssh", ".aws", ".gnupg", ".config/opencode", ".config/gh", ".local/share/opencode", ".claude", ".codex", ".hermes", ".grok"].map((relative) => path.join(home, relative)));
}

function expandHome(word: string): string {
  return word.startsWith("~/") ? path.join(os.homedir(), word.slice(2)) : word === "~" ? os.homedir() : word;
}

/**
 * The files a basename glob names, so the protected check sees what `cat .env*` would read. A glob in a folder
 * part, a POSIX class or no match expands to nothing; the step is then held as before.
 */
function globMatches(piece: string, cwd: string): readonly string[] {
  if (!/[*?[]/u.test(piece) || piece.includes("[[:")) return [];
  const expanded = expandHome(piece);
  const folder = path.dirname(expanded);
  const base = path.basename(expanded);
  if (/[*?[]/u.test(folder)) return [];
  let source = "";
  for (let index = 0; index < base.length; index += 1) {
    const char = base[index];
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const close = base.indexOf("]", index + 2);
      if (close < 0) return [];
      source += `[${base.slice(index + 1, close).replace(/^!/u, "^").replace(/\\/gu, "\\\\")}]`;
      index = close;
    } else source += char.replace(/[.+^${}()|\\]/gu, "\\$&");
  }
  let names: string[];
  try {
    names = fs.readdirSync(path.resolve(cwd, folder));
  } catch {
    return [];
  }
  const pattern = new RegExp(`^${source}$`, "u");
  return names.filter((name) => pattern.test(name) && (base.startsWith(".") || !name.startsWith("."))).map((name) => path.join(folder, name));
}

const removers = new Set(["rm", "rmdir", "unlink", "shred", "trash", "truncate", "chmod", "chown", "chgrp", "tar"]);
const movers = new Set(["mv", "cp", "rsync", "install", "ditto", "ln"]);

/**
 * A command may not remove, move or replace a folder that holds the run's state or the git folders. Removal
 * targets and the sources of a move are checked as holders; a destination folder is checked as
 * dest/basename(source), so `cp ../x .` passes and `mv .git x` does not. `git clean` is checked on the
 * folder it cleans, `git stash -u|-a` on the whole repository, `find … -delete` on its start folders.
 */
function holderReason(words: readonly string[], cwd: string, ctx: ShellContext, roots: readonly string[], runCtx: ReturnType<typeof defaultRunPathContext>): string | undefined {
  const holds = (word: string, base = cwd): boolean => {
    const expanded = expandHome(word);
    const candidate = resolveTarget(base, expanded).real;
    const lexical = path.resolve(base, expanded);
    return stateHolders(ctx).some((held) => withinAnyCase(candidate, held) || withinAnyCase(lexical, held));
  };
  const refused = "it would remove, move or replace a folder that holds the run's state or `.git`";
  const verb = words[0];
  if (verb === undefined) return undefined;
  if (verb === "git") {
    let index = 1;
    let gitCwd = cwd;
    while (words[index]?.startsWith("-")) {
      if (words[index] === "-C" && words[index + 1] !== undefined) {
        gitCwd = resolveTarget(cwd, expandHome(words[index + 1])).real;
        index += 2;
      } else index += 1;
    }
    const sub = words[index];
    const rest = words.slice(index + 1);
    if (sub === "clean") {
      const specs = rest.filter((word) => !word.startsWith("-"));
      return (specs.length === 0 ? holds(".", gitCwd) : specs.some((word) => holds(word, gitCwd))) ? refused : undefined;
    }
    // git takes any unambiguous prefix of a long option: `--inc` is `--include-untracked`, `--al` is `--all`.
    const stashAll = (word: string): boolean => /^-[A-Za-z]*[ua]$/u.test(word) || (word.length >= 5 && "--include-untracked".startsWith(word)) || (word.length >= 3 && "--all".startsWith(word));
    if (sub === "stash" && rest.some(stashAll)) return refused;
    if (sub === "rm" || sub === "mv") return rest.filter((word) => !word.startsWith("-")).some((word) => holds(word, gitCwd)) ? refused : undefined;
    return undefined;
  }
  const operands: string[] = [];
  let target: string | undefined;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if ((word === "-t" || word === "--target-directory") && words[index + 1] !== undefined) {
      target = words[index + 1];
      index += 1;
    } else if (word.startsWith("--target-directory=")) target = word.slice("--target-directory=".length);
    else if (!word.startsWith("-") || word === "-") operands.push(word);
  }
  if (verb === "find" && words.includes("-delete")) {
    const starts = words.slice(1).filter((word, index, all) => !word.startsWith("-") && all.slice(0, index).every((before) => /^-[HLP]$/u.test(before) || !before.startsWith("-")));
    return (starts.length === 0 ? ["."] : starts).some((word) => holds(word)) ? refused : undefined;
  }
  if (removers.has(verb)) return operands.some((word) => holds(word)) ? refused : undefined;
  if (!movers.has(verb)) return undefined;
  const sources = target === undefined ? operands.slice(0, -1) : operands;
  const dest = target ?? operands.at(-1);
  if (verb !== "cp" && verb !== "rsync" && verb !== "install" && verb !== "ditto" && sources.some((word) => holds(word))) return refused;
  if (dest === undefined) return undefined;
  const destPath = resolveTarget(cwd, expandHome(dest));
  const effective = destPath.isDirectory ? sources.map((word) => path.join(destPath.real, path.basename(expandHome(word)))) : [destPath.real];
  for (const placed of effective) {
    if (stateHolders(ctx).some((held) => withinAnyCase(held, placed) || withinAnyCase(placed, held))) return refused;
    const reason = pieceReason(placed, cwd, ctx, roots, runCtx, { mutating: true, writing: true, recursive: false });
    if (reason !== undefined) return reason;
  }
  return undefined;
}

function protectedReason(command: string, cwd: string, ctx: ShellContext): string | undefined {
  const stripped = command.replace(/["']/gu, "");
  if (/(?:^|[\s=:])~[A-Za-z_]/u.test(stripped)) return "another account's home (`~user`) is refused";
  const roots = hostProtectedRoots(ctx.protectedRoots ?? []);
  // Each `cd` moves the folder later words resolve against, and the folder it enters is checked like any operand.
  // The mode (mutating, writing, recursive) is the segment's own, so `grep -r x src && ls ~` checks `ls ~` as a plain read.
  let here = cwd;
  for (const segment of stripped.split(/&&|\|\||[;|&()]/u)) {
    const own = segment.trim();
    const outputRedirect = /(?<![0-9&])>|[0-9]>(?!&1|\s*\/dev\/null)/u.test(own.replace(/2>&1|2>\s*\/dev\/null/gu, ""));
    const mode: PieceMode = { mutating: mutatingVerb.test(own), writing: writingVerb.test(own) || outputRedirect, recursive: recursiveReader.test(own) };
    const words = own.split(/[\s<>]+/u).filter((word) => word !== "");
    const runCtx = defaultRunPathContext(ctx.projectRoot, here);
    // A jq module path loads code from that folder, so `lit approve x` must never be able to replay it.
    if (words[0] === "jq" && words.some((word) => /^(?:-L|--library-path)/u.test(word))) return "jq -L (a module library path) is refused";
    const holder = holderReason(words, here, ctx, roots, runCtx);
    if (holder !== undefined) return holder;
    for (const word of words) {
      for (const piece of word.includes("=") ? [word, word.slice(word.indexOf("=") + 1)] : [word]) {
        for (const match of globMatches(piece, here)) {
          const reason = pieceReason(match, here, ctx, roots, runCtx, mode);
          if (reason !== undefined) return reason;
        }
        const reason = pieceReason(piece, here, ctx, roots, runCtx, mode);
        if (reason !== undefined) return reason;
      }
    }
    if (words[0] === "cd") {
      const target = words[1] ?? "~";
      const expanded = target.startsWith("~/") ? path.join(os.homedir(), target.slice(2)) : target === "~" ? os.homedir() : target;
      const reason = pieceReason(expanded, here, ctx, roots, runCtx, { mutating: false, writing: false, recursive: false });
      if (reason !== undefined) return reason;
      here = resolveTarget(here, expanded).real;
    }
  }
  return undefined;
}

/** The shell's protected-path check for one file a file tool would write: secrets, settings, host homes, state, git. */
export function protectedWriteReason(filePath: string, ctx: ShellContext): string | undefined {
  if (/^~[A-Za-z_]/u.test(filePath)) return "another account's home (`~user`) is refused";
  return pieceReason(filePath, ctx.cwd, ctx, hostProtectedRoots(ctx.protectedRoots ?? []), defaultRunPathContext(ctx.projectRoot, ctx.cwd), { mutating: false, writing: true, recursive: false });
}

// ---------------------------------------------------------------------------------------------
// Segments and verbs.

type Segment = { readonly words: readonly Word[]; readonly pipes: readonly (readonly Word[])[]; readonly redirects: readonly string[] };

const heldVerbs = new Set([
  "time", "nice", "nohup", "timeout", "stdbuf", "ionice", "chroot", "doas", "sudo", "su", "env", "command",
  "builtin", "exec", "eval", "source", ".", "xargs", "alias", "unalias", "set", "shopt", "trap", "enable",
  "pushd", "popd", "export", "unset", "declare", "typeset", "local", "readonly", "!", "watch", "caffeinate"
]);
const shells = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
const readers = new Set(["cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "find", "ls", "sed", "jq", "sort", "uniq", "cut", "diff", "stat", "file", "nl", "tr"]);
const filters = new Set(["cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "sed", "jq", "sort", "uniq", "cut", "nl", "tr"]);
const patternFirst = new Set(["grep", "egrep", "fgrep", "rg", "sed", "jq", "tr"]);
const gitReaders = new Set(["status", "diff", "log", "show", "blame", "ls-files"]);
const gitBranchListing = new Set(["--show-current", "--list", "-l", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose"]);
const networkVerbs = new Set(["curl", "wget", "ssh", "scp", "sftp", "rsync", "gh", "docker", "podman", "aws", "gcloud", "az", "kubectl", "helm", "terraform", "nc", "ncat", "telnet", "ftp"]);
const packageRunners = new Set(["npm", "npx", "pnpm", "pnpx", "yarn", "bun", "bunx", "make", "gmake", "cargo", "go", "gradle", "mvn", "pip", "pip3", "uv", "poetry"]);
const deleters = new Set(["rm", "rmdir", "unlink", "shred", "truncate", "dd"]);
const localGit = new Set(["add", "commit", "status", "diff", "log", "show", "blame", "ls-files", "mv"]);

function splitSegments(tokens: readonly Token[]): { readonly segments: readonly Segment[]; readonly separators: readonly string[] } | { readonly problem: string } {
  const segments: Segment[] = [];
  const separators: string[] = [];
  let words: Word[] = [];
  let pipes: Word[][] = [];
  let redirects: string[] = [];
  let pendingRedirect = false;
  const close = (separator: string | undefined): string | undefined => {
    if (pendingRedirect) return "a redirect has no target";
    if (words.length === 0 && pipes.length === 0) return "an empty step";
    segments.push({ words, pipes, redirects });
    words = [];
    pipes = [];
    redirects = [];
    if (separator !== undefined) separators.push(separator);
    return undefined;
  };
  for (const token of tokens) {
    if (token.kind === "word") {
      if (pendingRedirect) {
        redirects[redirects.length - 1] += token.text;
        pendingRedirect = false;
        continue;
      }
      if (pipes.length > 0) pipes[pipes.length - 1].push(token);
      else words.push(token);
      continue;
    }
    if (token.text === "&&" || token.text === "||" || token.text === ";" || token.text === "&") {
      const problem = close(token.text);
      if (problem !== undefined) return { problem };
      continue;
    }
    if (token.text === "|") {
      if (words.length === 0 || (pipes.length > 0 && pipes[pipes.length - 1].length === 0)) return { problem: "an empty pipe step" };
      pipes.push([]);
      continue;
    }
    if (token.text === "(" || token.text === ")" || token.text === "|&") return { problem: "a subshell or unusual operator is not read" };
    redirects.push(token.text);
    pendingRedirect = !/(?:&\d+|\/dev\/null)$/u.test(token.text);
  }
  const trailing = segments.length > 0 && words.length === 0 && pipes.length === 0 && separators.at(-1) === ";";
  if (trailing) separators.pop();
  else {
    const problem = close(undefined);
    if (problem !== undefined) return { problem };
  }
  return { segments, separators };
}

function wordHold(word: Word): string | undefined {
  if (word.flags.has("dollar")) return "`$` expansion is not followed";
  if (word.flags.has("backtick")) return "backtick expansion is not followed";
  if (word.flags.has("backslash")) return "a `\\` escape is not read";
  if (word.flags.has("glob")) return "a glob is not expanded";
  if (word.flags.has("brace")) return "brace expansion is not read";
  if (word.flags.has("tilde")) return "`~` is not expanded";
  return undefined;
}

function segmentHold(segment: Segment): string | undefined {
  for (const redirect of segment.redirects) if (!allowedRedirects.has(redirect)) return "a redirect writes or reads a file the guard does not follow";
  const all = [segment.words, ...segment.pipes];
  for (const part of all) {
    if (part.length === 0) return "an empty pipe step";
    const verb = part[0].text;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(verb)) return "an assignment before the verb changes how it runs";
    if (heldVerbs.has(verb)) return `\`${verb}\` runs another verb or moves the shell, so the check cannot follow it`;
    if (verb === "cd" && part[1]?.text === "-") return "`cd -` goes to a folder the check cannot see";
    if (shells.has(verb) && part.some((word) => /^-\w*c/u.test(word.text))) return "a nested shell is not read";
    if (verb === "base64" && part.some((word) => /^-(?:d|D|-decode)$/u.test(word.text))) return "decoded text is not read";
    if (verb === "xxd" && part.some((word) => /^-r/u.test(word.text))) return "decoded bytes are not read";
    if (verb === "openssl") return "openssl output is not read";
    if (verb === "node" && part.some((word) => /^(?:-e|-p|--eval|--print|-pe)$/u.test(word.text))) return "inline code is not read";
    if (/^(?:python3?|ruby|perl|php|deno)$/u.test(verb) && part.some((word) => /^-[ce]$/u.test(word.text))) return "inline code is not read";
    for (const word of part) {
      const hold = wordHold(word);
      if (hold !== undefined) return hold;
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(word.text)) return "control characters are not read";
    }
  }
  return undefined;
}

function gitSubcommand(words: readonly Word[]): { readonly sub: string | undefined; readonly global: boolean } {
  let offset = 1;
  let global = false;
  while (offset < words.length && words[offset].text.startsWith("-")) {
    global = true;
    if (words[offset].text === "-C" || words[offset].text === "-c") offset += 2;
    else offset += 1;
  }
  return { sub: words[offset]?.text, global };
}

/** `git remote`, `-v` and `get-url` only read the local config; `show`, `update`, `prune` and the rest reach the remote or change it. */
function localRemoteForm(tail: readonly string[]): boolean {
  if (tail.length === 0) return true;
  if (tail.length === 1 && (tail[0] === "-v" || tail[0] === "--verbose")) return true;
  return tail[0] === "get-url" && tail.slice(1).every((word) => word === "--push" || word === "--all" || !word.startsWith("-"));
}

function isOutwardWords(words: readonly Word[], projectRoot: string, cwd: string): boolean {
  const verb = words[0]?.text;
  if (verb === undefined) return false;
  if (networkVerbs.has(verb) || packageRunners.has(verb) || deleters.has(verb)) return true;
  if (verb === "find" && words.some((word) => word.text === "-delete" || word.text === "-exec" || word.text === "-execdir")) return true;
  if (verb === "git") {
    const { sub, global } = gitSubcommand(words);
    if (!global && sub === "remote") return !localRemoteForm(words.slice(words.findIndex((word) => word.text === "remote") + 1).map((word) => word.text));
    return global || sub === undefined || !localGit.has(sub);
  }
  if (verb === "cd" && words[1] !== undefined && !within(projectRoot, resolveTarget(cwd, words[1].text).real)) return true;
  return false;
}

function grantCovers(ctx: ShellContext, real: string, action: "read" | "execute"): boolean {
  if (isOwnFolder(ctx, real)) return action === "read";
  return ctx.grants.some((grant) => (action === "read" || grant.action === "execute") && within(grant.root, real));
}

/** sort reads only with its ordering flags; any other flag, an output or compressor option, or a prefix of one, parks. */
function sortFlagsReadOnly(args: readonly Word[]): boolean {
  const long = /^--(?:numeric-sort|reverse|unique|ignore-case|ignore-leading-blanks|general-numeric-sort|human-numeric-sort|version-sort|month-sort|stable|dictionary-order|(?:key|field-separator)=.*)$/u;
  let takesValue = false;
  for (const word of args) {
    if (takesValue) { takesValue = false; continue; }
    const flag = word.text;
    if (flag === "-" || !flag.startsWith("-")) continue;
    if (flag.startsWith("--")) {
      if (flag === "--") return true;
      if (!long.test(flag)) return false;
      continue;
    }
    const cluster = /^-([nrufbdghMVs]*)(?:([kt])(.*))?$/u.exec(flag);
    if (cluster === null) return false;
    if (cluster[2] !== undefined && cluster[3] === "") takesValue = true;
  }
  return true;
}

function pathWords(verb: string, args: readonly Word[], cwd: string): readonly string[] {
  const grepLike = verb === "grep" || verb === "egrep" || verb === "fgrep" || verb === "rg";
  const scriptFlag = (verb === "sed" && args.some((word) => word.text === "-e" || word.text === "--expression" || word.text.startsWith("--expression=")))
    || (grepLike && args.some((word) => /^-[A-Za-z]*e/u.test(word.text) || /^--regexp(?:=|$)/u.test(word.text)));
  const operandWords: Word[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index].text;
    if (scriptFlag && (text === "-e" || text === "--expression" || text === "--regexp" || (grepLike && /^-[A-Za-z]*e$/u.test(text)))) index += 1;
    else if (!text.startsWith("-") || text === "-") operandWords.push(args[index]);
  }
  const candidates = patternFirst.has(verb) && !scriptFlag ? operandWords.slice(1) : operandWords;
  // The value of a `name=value` operand or a `--flag=value` option is checked as a path too.
  const values = args.map((word) => word.text).filter((text) => text.includes("=")).map((text) => text.slice(text.indexOf("=") + 1)).filter((text) => text !== "");
  return [...candidates.map((word) => word.text), ...values]
    .filter((text) => text !== "-" && (text.includes("/") || text.startsWith(".") || fs.existsSync(path.resolve(cwd, text))));
}

// A sed script is read-only only when every command is p, d, q, = or s///, with no w/W/e/r/R command or s flag.
const sedAddress = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
const sedCommand = new RegExp(String.raw`^(?:${sedAddress}(?:,${sedAddress})?)?!?\s*(?:[pdqQ=]|s([^\s\\\n])(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[gpiI0-9]*)?$`, "u");
const sedPlainFlags = new Set(["-n", "-E", "-r", "-s", "-u", "-z", "--quiet", "--silent", "--posix", "--regexp-extended", "--separate", "--unbuffered", "--null-data"]);

function sedReadOnly(args: readonly Word[]): boolean {
  const scripts: string[] = [];
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index].text;
    if (text === "-e" || text === "--expression") {
      const next = args[index + 1];
      if (next === undefined) return false;
      scripts.push(next.text);
      index += 1;
    } else if (text.startsWith("--expression=")) scripts.push(text.slice("--expression=".length));
    else if (text.startsWith("-") && text !== "-") {
      if (!sedPlainFlags.has(text)) return false;
    } else operands.push(text);
  }
  if (scripts.length === 0) {
    const first = operands.shift();
    if (first === undefined) return false;
    scripts.push(first);
  }
  return scripts.every((script) => script.split(/[;\n]/u).every((command) => sedCommand.test(command.trim())));
}

function readerAllowed(part: readonly Word[], cwd: string, ctx: ShellContext): boolean {
  const verb = part[0].text;
  const args = part.slice(1);
  if (verb === "git") {
    let rest = part;
    let gitCwd = cwd;
    if (part[1]?.text === "-C" && part[2] !== undefined) {
      gitCwd = resolveTarget(cwd, part[2].text).real;
      rest = [part[0], ...part.slice(3)];
    }
    const sub = rest[1]?.text;
    const tail = rest.slice(2).map((word) => word.text);
    // Listing forms only: `git branch -D|-d|-f|-m|-c`, a branch name or `git remote add` are not reads.
    if (sub === "branch") return tail.every((text) => gitBranchListing.has(text)) && grantCovers(ctx, gitCwd, "read");
    if (sub === "remote") return localRemoteForm(tail) && grantCovers(ctx, gitCwd, "read");
    if (sub === "rev-parse") return tail.every((text) => /^(?:--(?:show-toplevel|show-prefix|abbrev-ref|short|verify|is-inside-work-tree|git-dir|absolute-git-dir)|-q|HEAD|@)$/u.test(text)) && grantCovers(ctx, gitCwd, "read");
    if (sub === undefined || !gitReaders.has(sub)) return false;
    if (rest.slice(2).some((word) => /^--(?:output|ext-diff|textconv|exec|upload-pack|config)/u.test(word.text) || word.text === "-c")) return false;
    if (!grantCovers(ctx, gitCwd, "read")) return false;
    return rest.slice(2).every((word) => word.text.startsWith("-") || !word.text.includes("/") || grantCovers(ctx, resolveTarget(gitCwd, word.text).real, "read"));
  }
  // These only print; the lexer has already refused any redirect.
  if (verb === "pwd") return args.every((word) => word.text === "-P" || word.text === "-L") && grantCovers(ctx, cwd, "read");
  if (verb === "echo" || verb === "printf") return grantCovers(ctx, cwd, "read");
  if (!readers.has(verb)) return false;
  if (verb === "sed" && !sedReadOnly(args)) return false;
  if (verb === "uniq" && args.filter((word) => !word.text.startsWith("-") || word.text === "-").length > 1) return false;
  if (verb === "file" && args.some((word) => /^-(?:[A-Za-z]*C|-c)/u.test(word.text))) return false;
  if (verb === "sort" && !sortFlagsReadOnly(args)) return false;
  if ((verb === "grep" || verb === "egrep" || verb === "fgrep" || verb === "rg") && args.some((word) => /^-(?:[A-Za-z]*f|-file)/u.test(word.text))) return false;
  if (verb === "find" && args.some((word) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/u.test(word.text))) return false;
  if ((verb === "rg" || verb === "grep") && args.some((word) => /^--(?:pre|search-zip|hostname-bin)/u.test(word.text))) return false;
  // jq can read the environment (`env`, `$ENV`), its own arguments, and files named on the command line.
  if (verb === "jq" && args.some((word) => /^-L|^--library-path/u.test(word.text) || /(?:^|[^A-Za-z0-9_$])(?:import|include)(?![A-Za-z0-9_])/u.test(word.text))) return false;
  if (verb === "jq" && args.some((word) => /\$ENV|(?<![A-Za-z0-9_$])env(?![A-Za-z0-9_])|input_filename|\$__prog|\$__loc__|^--(?:rawfile|slurpfile|from-file)|^-f$/u.test(word.text))) return false;
  if (!grantCovers(ctx, cwd, "read")) return false;
  return pathWords(verb, args, cwd).every((word) => {
    const target = resolveTarget(cwd, word);
    return !target.dangling && grantCovers(ctx, target.real, "read");
  });
}

const doneCheckShape = /^node [\w./-]+\.(?:mjs|cjs|js)(?: [\w./=-]+)*$/u;

/** The Done-when checks the driver may run itself: `node <script>` with plain arguments, never a shell. */
export function isAllowlistedCheck(command: string | undefined): boolean {
  return command !== undefined && doneCheckShape.test(command);
}

function isDoneCheck(words: readonly Word[], ctx: ShellContext): boolean {
  if (!isAllowlistedCheck(ctx.doneCheck)) return false;
  return words.map((word) => word.text).join(" ") === ctx.doneCheck;
}

const repoScripts = /^(?:test|check|lint|build|typecheck)(?::[\w-]+)?$/u;

/**
 * The repository's own test and check commands: `npm test`, `npm run test|check|lint|build|typecheck`, and
 * `node --test` over project files, run from a project folder that holds its package.json. What such a script
 * does is the author's own code, the residual the docs name.
 */
function repoCheckAllowed(words: readonly Word[], cwd: string, ctx: ShellContext): boolean {
  if (!within(ctx.projectRoot, cwd) || !grantCovers(ctx, cwd, "execute")) return false;
  const texts = words.map((word) => word.text);
  const inProject = (text: string): boolean => {
    const target = resolveTarget(cwd, text);
    return !target.dangling && within(ctx.projectRoot, target.real) && grantCovers(ctx, target.real, "execute");
  };
  const plainTail = (tail: readonly string[]): boolean => tail.every((text) => /^[\w.:=@,+-]+$/u.test(text) ? !text.includes("=") || inProject(text.slice(text.indexOf("=") + 1)) : /^[\w./-]+$/u.test(text) && inProject(text));
  if (texts[0] === "node" && texts[1] === "--test") {
    const rest = texts.slice(2);
    return rest.every((text) => /^--test-(?:concurrency|reporter|name-pattern)=[\w.*-]+$/u.test(text) || (!text.startsWith("-") && /^[\w./-]+$/u.test(text) && inProject(text)));
  }
  if (texts[0] !== "npm" || !fs.existsSync(path.join(cwd, "package.json"))) return false;
  let tail: string[];
  if (texts[1] === "test" || texts[1] === "t") tail = texts.slice(2);
  else if (texts[1] === "run" && texts[2] !== undefined && repoScripts.test(texts[2])) tail = texts.slice(3);
  else return false;
  if (tail.length === 0) return true;
  return tail[0] === "--" && plainTail(tail.slice(1));
}

function nodeScriptAllowed(words: readonly Word[], cwd: string, ctx: ShellContext): boolean {
  if (words[0]?.text !== "node") return false;
  const script = words[1];
  if (script === undefined || script.text.startsWith("-")) return false;
  const paths = [script.text, ...words.slice(2).flatMap((word) => {
    if (word.text.startsWith("-")) {
      const value = word.text.includes("=") ? word.text.slice(word.text.indexOf("=") + 1) : "";
      return /^[./]|\//u.test(value) ? [value] : [];
    }
    return /^[./]|\//u.test(word.text) ? [word.text] : [];
  })];
  if (words.slice(2).some((word) => word.text.startsWith("-") && !word.text.includes("=") && word.text.includes("/"))) return false;
  if (!grantCovers(ctx, cwd, "execute")) return false;
  return paths.every((text) => {
    const target = resolveTarget(cwd, text);
    return !target.dangling && grantCovers(ctx, target.real, "execute");
  });
}

function touchesGitDir(projectRoot: string, cwd: string, text: string, target: Resolved): boolean {
  const lexical = path.resolve(cwd, text);
  const segments = [...path.relative(projectRoot, lexical).split(path.sep), ...path.relative(projectRoot, target.real).split(path.sep)];
  return segments.some((segment) => segment.toLowerCase() === ".git");
}

type PathCheck = { readonly ok: true } | { readonly ok: false; readonly refuse?: string };

function localTarget(ctx: ShellContext, cwd: string, text: string, mode: "new-or-existing" | "existing"): PathCheck {
  const target = resolveTarget(cwd, text);
  if (touchesGitDir(ctx.projectRoot, cwd, text, target)) return { ok: false, refuse: "a write inside `.git` is refused" };
  if (target.dangling) return { ok: false };
  if (!within(ctx.projectRoot, target.real)) return { ok: false };
  if (mode === "existing" && !target.exists) return { ok: false };
  return { ok: true };
}

type SegmentClass =
  | { readonly kind: "allow" }
  | { readonly kind: "cd"; readonly cwd: string }
  | { readonly kind: "B" }
  | { readonly kind: "X"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string };

function readRepoBranch(top: string): string | undefined {
  try {
    let gitDir = path.join(top, ".git");
    const stat = fs.lstatSync(gitDir);
    if (stat.isFile()) {
      const pointer = /^gitdir:[ \t]*(.+?)[ \t]*$/mu.exec(fs.readFileSync(gitDir, "utf8"));
      if (pointer === null) return undefined;
      gitDir = path.resolve(top, pointer[1]);
    }
    const head = /^ref: refs\/heads\/(.+?)\s*$/u.exec(fs.readFileSync(path.join(gitDir, "HEAD"), "utf8"));
    return head?.[1];
  } catch {
    return undefined;
  }
}

function repoTop(cwd: string): string | undefined {
  let current = cwd;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function charterCommitAllowed(words: readonly Word[], cwd: string, ctx: ShellContext): boolean {
  if (ctx.charter === undefined || words[0]?.text !== "git") return false;
  if (words[1]?.text !== "add" && words[1]?.text !== "commit") return false;
  const top = repoTop(cwd);
  if (top === undefined) return false;
  let repo: string;
  let charterRepo: string;
  try {
    repo = fs.realpathSync(top);
    charterRepo = fs.realpathSync(path.resolve(ctx.projectRoot, ctx.charter.repo));
  } catch {
    return false;
  }
  if (foldCase(repo) !== foldCase(charterRepo)) return false;
  // The branch is read from `.git` HEAD at call time, so a checkout of another branch loses the grant.
  if (readRepoBranch(top) !== ctx.charter.branch) return false;
  if (words[1].text === "add") return gitAddFilesOk(words.slice(2), cwd, ctx, repo);
  const args = words.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index].text;
    if (flag === "-m" || flag === "-F") {
      if (args[index + 1] === undefined) return false;
      if (flag === "-F") {
        const file = resolveTarget(cwd, args[index + 1].text);
        if (!file.exists || file.dangling || !within(repo, file.real)) return false;
      }
      index += 1;
      continue;
    }
    if (flag === "-a" || flag === "-q" || flag === "-aq" || flag === "-qa") continue;
    return false;
  }
  return args.some((word) => word.text === "-m" || word.text === "-F");
}

function gitAddFilesOk(files: readonly Word[], cwd: string, ctx: ShellContext, repo: string): boolean {
  const named = files.filter((word) => word.text !== "--");
  if (named.length === 0) return false;
  return named.every((word) => {
    if (word.text.startsWith("-") || word.text === "." || word.text === "*") return false;
    const target = resolveTarget(cwd, word.text);
    if (!target.exists || target.dangling || target.isDirectory) return false;
    if (touchesGitDir(ctx.projectRoot, cwd, word.text, target)) return false;
    return within(repo, target.real) && within(ctx.projectRoot, target.real);
  });
}

function classifySegment(segment: Segment, cwd: string, ctx: ShellContext): SegmentClass {
  const words = segment.words;
  const verb = words[0].text;
  if (segment.pipes.length > 0) {
    if (segment.pipes.length > 4) return { kind: "X", reason: "more than four filters" };
    if (!readerAllowed(words, cwd, ctx)) return { kind: "X", reason: "the first command of the pipe is not an allowed reader" };
    for (const filter of segment.pipes) {
      if (!filters.has(filter[0].text) || !readerAllowed(filter, cwd, ctx)) return { kind: "X", reason: `\`${filter[0].text}\` is not a read filter` };
    }
    return { kind: "allow" };
  }
  if (verb === "cd") {
    if (words.length === 1) return { kind: "refuse", reason: "a bare `cd` goes to a home folder" };
    if (words.length > 2) return { kind: "X", reason: "`cd` takes one folder" };
    const target = resolveTarget(cwd, words[1].text);
    if (!target.exists || target.dangling || !target.isDirectory) return { kind: "X", reason: "the folder does not exist" };
    return { kind: "cd", cwd: target.real };
  }
  if (isDoneCheck(words, ctx)) return { kind: "allow" };
  if (readerAllowed(words, cwd, ctx)) return { kind: "allow" };
  if (nodeScriptAllowed(words, cwd, ctx)) return { kind: "allow" };
  if (repoCheckAllowed(words, cwd, ctx)) return { kind: "allow" };
  if (charterCommitAllowed(words, cwd, ctx)) return { kind: "allow" };
  const args = words.slice(1).map((word) => word.text);
  if (verb === "touch") {
    if (args.length === 0 || args.some((arg) => arg.startsWith("-"))) return { kind: "X", reason: "`touch` with flags" };
    for (const arg of args) {
      const check = localTarget(ctx, cwd, arg, "new-or-existing");
      if (!check.ok) return check.refuse === undefined ? { kind: "X", reason: "a path is not a plain project path" } : { kind: "refuse", reason: check.refuse };
    }
    return { kind: "B" };
  }
  if (verb === "mkdir") {
    const operands = args.filter((arg) => arg !== "-p");
    if (operands.length === 0 || operands.some((arg) => arg.startsWith("-"))) return { kind: "X", reason: "`mkdir` with flags other than -p" };
    for (const arg of operands) {
      const check = localTarget(ctx, cwd, arg, "new-or-existing");
      if (!check.ok) return check.refuse === undefined ? { kind: "X", reason: "a path is not a plain project path" } : { kind: "refuse", reason: check.refuse };
    }
    return { kind: "B" };
  }
  if (verb === "cp" || verb === "mv") {
    const allowedFlags = verb === "cp" ? new Set(["-r", "-R", "-p"]) : new Set<string>();
    const flags = args.filter((arg) => arg.startsWith("-"));
    if (flags.some((flag) => !allowedFlags.has(flag))) return { kind: "X", reason: `\`${verb}\` with flags` };
    const operands = args.filter((arg) => !arg.startsWith("-"));
    if (operands.length < 2) return { kind: "X", reason: `\`${verb}\` needs a source and a destination` };
    const destination = operands[operands.length - 1];
    const sources = operands.slice(0, -1);
    for (const source of sources) {
      const check = localTarget(ctx, cwd, source, "existing");
      if (!check.ok) return check.refuse === undefined ? { kind: "X", reason: "a source is not a plain project path" } : { kind: "refuse", reason: check.refuse };
    }
    const target = resolveTarget(cwd, destination);
    if (touchesGitDir(ctx.projectRoot, cwd, destination, target)) return { kind: "refuse", reason: "a write inside `.git` is refused" };
    if (target.dangling || !within(ctx.projectRoot, target.real)) return { kind: "X", reason: "the destination is not a plain project path" };
    if (target.exists) {
      if (!target.isDirectory) return { kind: "X", reason: "the destination exists and would be overwritten" };
      for (const source of sources) {
        const inside = resolveTarget(target.real, path.basename(source));
        if (inside.exists || touchesGitDir(ctx.projectRoot, target.real, path.basename(source), inside)) return { kind: "X", reason: "the destination exists and would be overwritten" };
      }
    } else if (sources.length > 1) {
      return { kind: "X", reason: "several sources need an existing folder" };
    }
    return { kind: "B" };
  }
  if (verb === "git" && words[1]?.text === "add") {
    const top = repoTop(cwd);
    let repo: string | undefined;
    try {
      repo = top === undefined ? undefined : fs.realpathSync(top);
    } catch {
      repo = undefined;
    }
    if (repo !== undefined && gitAddFilesOk(words.slice(2), cwd, ctx, repo)) return { kind: "B" };
    return { kind: "X", reason: "`git add` of something other than named files" };
  }
  return { kind: "X", reason: `\`${verb}\` is not on the tier-B list` };
}

function selfCheckPart(segment: Segment, cwd: string, ctx: ShellContext): "keep" | "drop" | undefined {
  const verb = segment.words[0].text;
  if (segment.redirects.some((redirect) => !allowedRedirects.has(redirect))) return undefined;
  if (verb === "echo" || verb === "printf" || verb === "true" || verb === "false" || verb === "exit") return "drop";
  if (segmentHold(segment) !== undefined) return undefined;
  if (isDoneCheck(segment.words, ctx) && segment.pipes.length === 0) return "keep";
  const kind = classifySegment(segment, cwd, ctx).kind;
  return kind === "allow" ? "keep" : undefined;
}

function partText(segment: Segment): string {
  const quote = (word: Word): string => /^[\w./=:@%+,-]+$/u.test(word.text) ? word.text : `'${word.text.replaceAll("'", "'\\''")}'`;
  return [segment.words, ...segment.pipes].map((part) => part.map(quote).join(" ")).join(" | ");
}

function parked(tier: "B" | "X", reason: string, outward: boolean, hold?: string): ShellVerdict {
  return { kind: "park", tier, reason, outward, ...(hold === undefined ? {} : { hold }) };
}

function outwardText(command: string, ctx: ShellContext): boolean {
  const lexed = lex(command);
  const split = splitSegments(lexed.tokens);
  if ("problem" in split) return /\b(?:git|curl|wget|ssh|scp|rsync|gh|npm|npx|pnpm|yarn|bun|make|rm|unlink|docker|aws)\b/u.test(command);
  let cwd = ctx.cwd;
  for (const segment of split.segments) {
    for (const part of [segment.words, ...segment.pipes]) if (isOutwardWords(part, ctx.projectRoot, cwd)) return true;
    if (segment.words[0]?.text === "cd" && segment.words[1] !== undefined) cwd = resolveTarget(cwd, segment.words[1].text).real;
  }
  return false;
}

export function classifyShellCommand(command: string, ctx: ShellContext): ShellVerdict {
  if (typeof command !== "string" || command.trim() === "") return parked("X", "an empty command", false, "an empty step");
  const refused = protectedReason(command, ctx.cwd, ctx);
  if (refused !== undefined) return { kind: "refuse", reason: refused };
  const lexed = lex(command);
  if (lexed.problem !== undefined) return parked("X", lexed.problem, outwardText(command, ctx), lexed.problem);
  const split = splitSegments(lexed.tokens);
  if ("problem" in split) return parked("X", split.problem, outwardText(command, ctx), split.problem);
  const { segments, separators } = split;
  const outward = outwardText(command, ctx);
  const onlyAnd = separators.every((separator) => separator === "&&");

  if (!onlyAnd || segments.length > 4) {
    let cwd = ctx.cwd;
    const kept: string[] = [];
    let hintable = true;
    for (const segment of segments) {
      if (segment.words[0]?.text === "cd" && segment.words.length === 2) {
        const target = resolveTarget(cwd, segment.words[1].text);
        if (target.exists && target.isDirectory && !target.dangling) {
          cwd = target.real;
          kept.push(partText(segment));
          continue;
        }
      }
      const part = selfCheckPart(segment, cwd, ctx);
      if (part === undefined) {
        hintable = false;
        break;
      }
      if (part === "keep") kept.push(partText(segment));
    }
    if (hintable && kept.length > 0) return { kind: "split", parts: kept };
    for (const segment of segments) {
      const hold = segmentHold(segment);
      if (hold !== undefined) return parked("X", hold, outward, hold);
    }
    return parked("X", "`;`, `||`, `&` or more than four steps", outward);
  }

  let cwd = ctx.cwd;
  let allAllowed = true;
  let allLocal = true;
  let reason = "";
  for (const segment of segments) {
    const hold = segmentHold(segment);
    if (hold !== undefined) return parked("X", hold, outward, hold);
    const result = classifySegment(segment, cwd, ctx);
    if (result.kind === "refuse") return { kind: "refuse", reason: result.reason };
    if (result.kind === "cd") {
      cwd = result.cwd;
      if (!grantCovers(ctx, cwd, "read")) allAllowed = false;
      if (!within(ctx.projectRoot, cwd)) allLocal = false;
      continue;
    }
    if (result.kind === "allow") {
      allLocal = false;
      continue;
    }
    allAllowed = false;
    if (result.kind === "X") {
      allLocal = false;
      reason = result.reason;
    }
  }
  if (allAllowed) return { kind: "allow", reason: "every step is a reader, the Done-when check, a granted script or a charter commit" };
  if (allLocal) return parked("B", "local and undoable inside the project", false);
  return parked("X", reason === "" ? "not on the tier-B list" : reason, outward);
}
