#!/usr/bin/env node
// lit-adhd collector. It reads what earlier OpenCode sessions in this worktree family left behind and
// prints one brief to pick the work back up. Everything it opens is opened read-only, every string it
// prints passes through redact(), and it never writes anything except the one-line next-step record
// that `go` follows (and only when asked with --write-next). Zero dependencies: Node built-ins, git on PATH.
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REWIND_SCHEMA = "litopencode.rewind/v1";
export const NEXT_SCHEMA = "litopencode.adhd-next/v1";
export const STACK_SCHEMA = "litopencode.workflow-stack/v1";
const SQL_TABLES = new Set(["session", "message", "part", "todo"]);
const TOTAL_BYTE_BUDGET = 8 * 1024 * 1024;
const FILE_CAP = 256 * 1024;
const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ACTIVE_WINDOW_MS = 2 * 60_000;
// Another worktree's plan is shown only when it changed inside this window; an older one is history.
const PLAN_WINDOW_MS = 7 * 24 * 60 * 60_000;
const ENDED_ROWS = 8;
const STATUS_WORDS = ["working", "waits-on-you", "blocked", "paused", "done", "idle"];

// ---------------------------------------------------------------------------------------------
// Redaction. The alternatives below are the credential shapes of the plugin's own secret filter; a
// test fails when they drift apart, because a skill script cannot import the plugin source.

const SECRET_ALTERNATIVES = [
  String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`,
  String.raw`(?<![A-Za-z0-9_])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])github_pat[_-][A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`\bsk-[A-Za-z0-9_-]{20,}\b`,
  String.raw`(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`,
  String.raw`(?<![A-Za-z0-9_])(?:xox[baprs]|xapp)-[A-Za-z0-9-]{8,}(?![A-Za-z0-9_-])`,
  String.raw`(?<![A-Za-z0-9_])whsec_[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])hf_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])glpat-[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_])`,
  String.raw`\b(?:authorization|proxy-authorization)\s*:\s*\S+\s+\S+`,
  String.raw`\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])`,
  String.raw`\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:token|secret|key)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b_?auth(?:[_-]?token)?["']?\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`(?<![A-Za-z0-9+.-])(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/?#\s]+@`,
];
export const SECRET_SHAPE_SOURCE = `(?:${SECRET_ALTERNATIVES.join("|")})`;
const SECRET_SPANS = new RegExp(SECRET_SHAPE_SOURCE, "giu");
const LOWERCASE_TOKEN = /\btoken\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/gu;
const NAMED_ASSIGNMENT = /(?<![A-Za-z0-9_])(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?token|auth[_-]?token|[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:password|passwd|passphrase|secret|token|key)(?:[_-][A-Za-z0-9]+)*)["']?\s*[=:]\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/giu;
const SECRET_ENV_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/iu;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/gu;

const secretEnvValues = () =>
  Object.entries(process.env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value);

export function redact(value, extra = {}) {
  let text = String(value ?? "").replace(CONTROL, " ");
  // A secret value is also caught in the forms a URL or a header carries it in.
  for (const secret of extra.envValues ?? secretEnvValues()) {
    for (const form of new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString("base64")])) text = text.split(form).join("[redacted]");
  }
  text = text.replace(SECRET_SPANS, "[redacted]").replace(NAMED_ASSIGNMENT, "[redacted]").replace(LOWERCASE_TOKEN, "[redacted]");
  const home = extra.home ?? homedir();
  if (home.length > 1) text = text.split(home).join("~");
  return text;
}

export function clip(value, max) {
  const flat = String(value ?? "").replace(/\s+/gu, " ").trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

const clean = (value, max) => clip(redact(value), max);

// ---------------------------------------------------------------------------------------------
// Terminal width: Hangul, kana, CJK and emoji take two cells. Same table as the TUI's cellWidth.

const isWide = (code) =>
  (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0x303e) || (code >= 0x3041 && code <= 0x33ff) ||
  (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xa000 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1f64f) ||
  (code >= 0x1f900 && code <= 0x1f9ff) || (code >= 0x20000 && code <= 0x3fffd);
const isZeroWidth = (code) => (code >= 0x0300 && code <= 0x036f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x1160 && code <= 0x11ff);

export function cellWidth(value) {
  let width = 0;
  for (const char of String(value)) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || isZeroWidth(code)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function cutCells(value, max) {
  const flat = String(value).replace(/\s+/gu, " ").trim();
  if (cellWidth(flat) <= max) return flat;
  let out = "";
  let width = 0;
  for (const char of flat) {
    const next = cellWidth(char);
    if (width + next > max - 1) break;
    out += char;
    width += next;
  }
  return `${out}…`;
}

const padCells = (value, width) => value + " ".repeat(Math.max(0, width - cellWidth(value)));

// ---------------------------------------------------------------------------------------------
// Progress without placeholders: a bar only for a real total, known facts in words otherwise.

export const isRealCount = (done, total) => Number.isInteger(done) && Number.isInteger(total) && total > 0 && done >= 0 && done <= total;

export function gauge(done, total, { ascii = false, cells = 10 } = {}) {
  if (!isRealCount(done, total)) return undefined;
  const filled = Math.min(cells, Math.round((done / total) * cells));
  const on = ascii ? "#" : "▉";
  const off = ascii ? "-" : "░";
  return `[${on.repeat(filled)}${off.repeat(cells - filled)}] ${done}/${total}`;
}

export const pulse = (ascii = false) => (ascii ? "~=~" : "░▒▓▒░");

export function elapsedWords(minutes) {
  if (!Number.isFinite(minutes) || minutes < 1) return undefined;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  if (whole < 24 * 60) return `${Math.floor(whole / 60)}h ${whole % 60}m`;
  return `${Math.floor(whole / 1440)}d`;
}

export function factsLine(facts) {
  const parts = [];
  if (Number.isInteger(facts.steps) && facts.steps > 0) parts.push(`${facts.steps} step${facts.steps === 1 ? "" : "s"}`);
  const elapsed = elapsedWords(facts.elapsedMin);
  if (elapsed !== undefined) parts.push(elapsed);
  if (Number.isInteger(facts.lanes) && facts.lanes > 0) parts.push(`${facts.lanes} lane${facts.lanes === 1 ? "" : "s"}`);
  if (facts.lastAction) parts.push(`last: ${facts.lastAction}`);
  return parts.length === 0 ? "nothing recorded yet" : parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Guarded reads

export function guardSql(sql) {
  if (!/^\s*SELECT\b/iu.test(sql) || sql.includes(";")) throw new Error("only a single SELECT is allowed");
  const tables = [...sql.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/giu)].map((match) => match[1].toLowerCase());
  if (tables.length === 0 || tables.some((table) => !SQL_TABLES.has(table))) throw new Error("table outside the allowlist");
  return sql;
}

// `skipped` counts regular files left unread because the budget ran out, so the brief can say so.
const budget = { left: TOTAL_BYTE_BUDGET, skipped: 0 };

function readSmall(file, max = FILE_CAP) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.size > max) return undefined;
  if (stat.size > budget.left) {
    budget.skipped += 1;
    return undefined;
  }
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) return undefined;
    const buffer = Buffer.alloc(stat.size);
    const got = readSync(fd, buffer, 0, stat.size, 0);
    budget.left -= got;
    return buffer.subarray(0, got).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readJson(file, max) {
  const text = readSmall(file, max);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : "");

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024 });
  } catch {
    return "";
  }
}

export function worktreeFamily(root) {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  const entries = [];
  let current;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { dir: line.slice(9).trim(), branch: "" };
      entries.push(current);
    } else if (line.startsWith("branch ") && current) current.branch = line.slice(7).replace(/^refs\/heads\//u, "").trim();
    else if (line === "detached" && current) current.branch = "(detached)";
  }
  if (entries.length === 0) entries.push({ dir: resolve(root), branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() });
  return entries.slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// Local state of one worktree: plans, goal, bounded run, workflow stacks, handoff headings, history.

export function planChecklist(text) {
  let done = 0;
  let total = 0;
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^- \[( |x|X)\] +(.*)$/u.exec(line);
    if (match === null) continue;
    total += 1;
    const finished = match[1] !== " ";
    if (finished) done += 1;
    rows.push({ done: finished, title: match[2].split(" — ")[0].trim() });
  }
  return total === 0 ? undefined : { done, total, rows };
}

// A plan scaffold nobody filled in: a row still holding a `<placeholder>`, or every row the same.
export const isScaffold = (rows) => rows.some((row) => /<[^<>]{1,40}>/u.test(row.title)) || (rows.length > 1 && new Set(rows.map((row) => row.title)).size === 1);

function goalOf(raw) {
  if (!isRecord(raw)) return undefined;
  let goal = raw;
  if (Array.isArray(raw.goals)) {
    const list = raw.goals.filter((entry) => isRecord(entry) && Array.isArray(entry.criteria));
    goal = raw.activeGoalId === undefined ? list.at(-1) : list.find((entry) => entry.id === raw.activeGoalId);
  } else if (isRecord(raw.goal) && Array.isArray(raw.goal.criteria)) goal = raw.goal;
  if (!isRecord(goal) || !Array.isArray(goal.criteria)) return undefined;
  const passing = new Set(["pass", "passed", "complete", "completed", "done"]);
  const criteria = goal.criteria.filter(isRecord);
  return {
    title: str(goal.title) || str(goal.objective),
    done: criteria.filter((entry) => passing.has(str(entry.status))).length,
    total: criteria.length,
    open: criteria.filter((entry) => !passing.has(str(entry.status))).map((entry) => str(entry.scenario)).filter(Boolean),
    closed: criteria.filter((entry) => passing.has(str(entry.status))).map((entry) => str(entry.scenario)).filter(Boolean),
  };
}

// An item someone already marked finished; the words are matched case-sensitively, so "done" in prose stays open.
const HANDOFF_DONE = /✅|✓|^\[[xX]\]|~~.+~~|\b(?:DONE|SHIPPED)\b/u;

// The first open list item or line of text under a `Next` or `Next Steps` heading, without its marker.
function handoffNextOf(text) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^#{1,6}\s+Next(?:\s+Steps)?\s*$/iu.test(line.trim()));
  if (start < 0) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/u.test(line.trim())) return undefined;
    const item = line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/u, "");
    if (item !== "" && !HANDOFF_DONE.test(item)) return item;
  }
  return undefined;
}

export function readLocalState(dir) {
  const state = { plans: [], plansSkipped: 0, goal: undefined, goalChangedMs: 0, work: undefined, stacks: new Map(), liveness: new Map(), handoff: [], handoffNext: undefined, commits: [], dirty: 0, ahead: undefined };
  const litLoop = join(dir, ".litopencode", "litgoal", "lit-loop");
  const skippedBefore = budget.skipped;
  for (const planDir of [join(dir, "plans"), join(dir, ".litopencode", "plans")]) {
    let names = [];
    try {
      names = readdirSync(planDir).filter((name) => name.endsWith(".md")).slice(0, 40);
    } catch {
      continue;
    }
    for (const name of names) {
      const text = readSmall(join(planDir, name), FILE_CAP);
      const checklist = text === undefined ? undefined : planChecklist(text);
      if (checklist === undefined || isScaffold(checklist.rows)) continue;
      const heading = /^#\s+(.+)$/mu.exec(text);
      let changedMs = 0;
      try {
        changedMs = lstatSync(join(planDir, name)).mtimeMs;
      } catch {
        // gone since the listing
      }
      state.plans.push({ path: relative(dir, join(planDir, name)), title: heading ? heading[1].replace(/\s*—\s*Work Plan$/u, "").trim() : name, changedMs, complete: checklist.done === checklist.total, ...checklist });
    }
  }
  state.plansSkipped = budget.skipped - skippedBefore;
  state.goal = goalOf(readJson(join(litLoop, "goals.json")));
  try {
    state.goalChangedMs = lstatSync(join(litLoop, "goals.json")).mtimeMs;
  } catch {
    // no goal file
  }
  const work = readJson(join(litLoop, "work-schema-3.json"));
  if (isRecord(work) && work.schemaVersion === 3) {
    const planPath = isRecord(work.plan) ? str(work.plan.path) : "";
    state.work = {
      sessionID: str(work.sessionID),
      status: str(work.status),
      planPath,
      plan: planPath === "" ? "" : !isAbsolute(planPath) ? planPath : relative(dir, planPath).startsWith("..") ? basename(planPath) : relative(dir, planPath),
      updatedMs: Date.parse(str(work.updatedAt)),
      boundary: isRecord(work.pendingBoundary) ? `${str(work.pendingBoundary.action)} on ${basename(str(work.pendingBoundary.root))}` : undefined,
      // Steps the run parked while it keeps working; a count only, never a reason to wait.
      parked: Array.isArray(work.parkedBoundaries) ? work.parkedBoundaries.filter(isRecord).length : 0,
    };
  }
  // Each session's last lifecycle signal (alive, idle, ended), written by the plugin's hooks.
  const livenessDir = join(dir, ".litopencode", "liveness");
  try {
    for (const name of readdirSync(livenessDir).filter((entry) => entry.endsWith(".json")).slice(0, 40)) {
      const record = readJson(join(livenessDir, name), 1024);
      const atMs = isRecord(record) ? Date.parse(str(record.at)) : Number.NaN;
      if (isRecord(record) && SAFE_SESSION.test(str(record.sessionId)) && ["alive", "idle", "ended"].includes(record.state) && Number.isFinite(atMs)) {
        state.liveness.set(record.sessionId, { state: record.state, atMs, pane: typeof record.herdrPane === "string" ? clean(record.herdrPane, 32) : undefined });
      }
    }
  } catch {
    // no liveness records for this worktree
  }
  const stackDir = join(dir, ".litopencode", "workflow-stack");
  try {
    for (const name of readdirSync(stackDir).filter((entry) => entry.endsWith(".json")).slice(0, 40)) {
      const stack = readJson(join(stackDir, name), 64 * 1024);
      if (isRecord(stack) && stack.schema === STACK_SCHEMA && Array.isArray(stack.frames)) state.stacks.set(str(stack.sessionID), stack);
    }
  } catch {
    // no stacks recorded for this worktree
  }
  // The newest handoff file first: a lane's fresh HANDOFF beats an old root one.
  try {
    const changed = (name) => {
      try {
        return lstatSync(join(dir, name)).mtimeMs;
      } catch {
        return 0;
      }
    };
    const names = readdirSync(dir).filter((entry) => /^HANDOFF.*\.md$/u.test(entry)).slice(0, 40);
    for (const name of names.map((entry) => [entry, changed(entry)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([entry]) => entry)) {
      const text = readSmall(join(dir, name), FILE_CAP);
      if (text === undefined) continue;
      state.handoff.push(...[...text.matchAll(/^#{1,3}\s+(.+)$/gmu)].slice(0, 4).map((match) => clean(match[1], 80)));
      const next = handoffNextOf(text);
      if (state.handoffNext === undefined && next !== undefined) state.handoffNext = clean(next, 120);
    }
  } catch {
    // no handoff file
  }
  state.commits = git(dir, ["log", "-n", "6", "--format=%cI%x09%s"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [at, ...subject] = line.split("\t");
      return { at, subject: clean(subject.join("\t"), 90) };
    });
  // For the board's reminders: changed or untracked paths, and commits the upstream does not have yet. A
  // branch without an upstream gives no count, so no reminder is made up for it.
  state.dirty = git(dir, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
  const ahead = git(dir, ["rev-list", "--count", "@{upstream}..HEAD"]).trim();
  state.ahead = /^\d+$/u.test(ahead) ? Number(ahead) : undefined;
  return state;
}

// ---------------------------------------------------------------------------------------------
// Stores. Both return the same shapes so the card logic is shared.

const TOOL_VERB = { edit: "Edit", write: "Write", read: "Read", bash: "Run", task: "Task", grep: "Search", glob: "Find", webfetch: "Fetch", question: "Ask", todowrite: "Plan" };

function lastActionOf(tool, input) {
  const verb = TOOL_VERB[tool] ?? tool;
  // A shell call's own description already says what it does ("Run the gates"); never its command line.
  if (tool === "bash" && isRecord(input) && str(input.description) !== "") return clean(input.description, 60);
  const target = isRecord(input) ? str(input.filePath) || str(input.path) || str(input.description) || str(input.command) || str(input.pattern) : "";
  return clean(target === "" ? verb : `${verb} ${basename(target) === target ? target : basename(target)}`, 60);
}

function summarize(sessionRow, parts, firstPrompt, todos, steps) {
  const tools = [];
  let lastText = "";
  for (const part of parts) {
    if (part.type === "tool" && isRecord(part.state)) tools.push({ tool: str(part.tool), status: str(part.state.status), input: part.state.input });
    else if (part.type === "text" && lastText === "" && part.role === "assistant" && str(part.text).trim() !== "") lastText = str(part.text);
  }
  return { ...sessionRow, firstPrompt, lastText, tools, steps, todos };
}

export async function openSqlite(file) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return { error: "node:sqlite is not available in this Node (22.5 or newer is needed)" };
  }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
  } catch {
    return { error: "the session store could not be opened read-only" };
  }
  const all = (sql, ...params) => db.prepare(guardSql(sql)).all(...params);
  const json = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  return {
    kind: "sqlite",
    sessions(dirs, limit) {
      if (dirs.length === 0) return [];
      const marks = dirs.map(() => "?").join(",");
      return all(
        `SELECT id, directory, title, time_created AS created, time_updated AS updated FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND directory IN (${marks}) ORDER BY time_updated DESC LIMIT ?`,
        ...dirs,
        limit,
      ).map((row) => ({ id: str(row.id), directory: str(row.directory), title: str(row.title), created: Number(row.created), updated: Number(row.updated) }));
    },
    lanes(ids) {
      if (ids.length === 0) return new Map();
      const marks = ids.map(() => "?").join(",");
      const rows = all(`SELECT parent_id AS parent, COUNT(*) AS n FROM session WHERE parent_id IN (${marks}) AND time_archived IS NULL GROUP BY parent_id`, ...ids);
      return new Map(rows.map((row) => [str(row.parent), Number(row.n)]));
    },
    detail(row) {
      const messages = all("SELECT id, data FROM message WHERE session_id = ? AND length(data) <= 65536 ORDER BY time_created ASC LIMIT 400", row.id)
        .map((entry) => ({ id: str(entry.id), role: str(json(entry.data)?.role) }));
      const role = new Map(messages.map((message) => [message.id, message.role]));
      const parts = all("SELECT message_id AS mid, data FROM part WHERE session_id = ? AND length(data) <= 65536 ORDER BY time_created DESC LIMIT 80", row.id)
        .map((entry) => ({ ...(json(entry.data) ?? {}), role: role.get(str(entry.mid)) ?? "" }));
      const firstUser = messages.find((message) => message.role === "user");
      let firstPrompt = "";
      if (firstUser !== undefined) {
        const first = all("SELECT data FROM part WHERE message_id = ? AND length(data) <= 65536 ORDER BY time_created ASC LIMIT 6", firstUser.id)
          .map((entry) => json(entry.data))
          .find((part) => isRecord(part) && part.type === "text" && !part.synthetic);
        firstPrompt = first ? str(first.text) : "";
      }
      const steps = Number(all("SELECT COUNT(*) AS n FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'", row.id)[0]?.n ?? 0);
      const todos = all("SELECT content, status FROM todo WHERE session_id = ? ORDER BY position LIMIT 100", row.id).map((entry) => ({ content: str(entry.content), status: str(entry.status) }));
      return summarize(row, parts, firstPrompt, todos, steps);
    },
  };
}

export function openLegacy(storageDir) {
  const sessionRoot = join(storageDir, "session");
  try {
    readdirSync(sessionRoot);
  } catch {
    return { error: "no session store was found" };
  }
  const listJson = (dir, limit) => {
    try {
      return readdirSync(dir).filter((name) => name.endsWith(".json")).slice(0, limit).map((name) => join(dir, name));
    } catch {
      return [];
    }
  };
  return {
    kind: "legacy",
    sessions(dirs, limit) {
      const wanted = new Set(dirs);
      const found = [];
      for (const project of readdirSync(sessionRoot).slice(0, 200)) {
        for (const file of listJson(join(sessionRoot, project), 400)) {
          const info = readJson(file, 64 * 1024);
          if (!isRecord(info) || info.parentID || !wanted.has(str(info.directory))) continue;
          const time = isRecord(info.time) ? info.time : {};
          found.push({ id: str(info.id), directory: str(info.directory), title: str(info.title), created: Number(time.created ?? 0), updated: Number(time.updated ?? 0) });
        }
      }
      return found.sort((a, b) => b.updated - a.updated).slice(0, limit);
    },
    lanes() {
      return new Map();
    },
    detail(row) {
      if (!SAFE_SESSION.test(row.id)) return summarize(row, [], "", [], 0);
      const messages = listJson(join(storageDir, "message", row.id), 400).map((file) => readJson(file, 64 * 1024)).filter(isRecord);
      messages.sort((a, b) => Number(a.time?.created ?? 0) - Number(b.time?.created ?? 0));
      const parts = [];
      let steps = 0;
      let firstPrompt = "";
      for (const message of messages) {
        const id = str(message.id);
        if (!SAFE_SESSION.test(id)) continue;
        for (const part of listJson(join(storageDir, "part", id), 60).map((file) => readJson(file, 64 * 1024)).filter(isRecord)) {
          if (part.type === "tool") steps += 1;
          if (firstPrompt === "" && message.role === "user" && part.type === "text" && !part.synthetic) firstPrompt = str(part.text);
          parts.push({ ...part, role: str(message.role) });
        }
      }
      const todoFile = readJson(join(storageDir, "todo", `${row.id}.json`), 64 * 1024);
      const todos = Array.isArray(todoFile) ? todoFile.filter(isRecord).map((entry) => ({ content: str(entry.content), status: str(entry.status) })) : [];
      return summarize(row, parts.slice(-80).reverse(), firstPrompt, todos, steps);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Cards

export function countChain({ sessionID, directory, local, detail }) {
  const stack = local.stacks.get(sessionID);
  const frame = stack?.frames?.find((entry) => isRecord(entry) && Number.isInteger(entry.done) && Number.isInteger(entry.total));
  if (frame && isRealCount(frame.done, frame.total)) return { done: frame.done, total: frame.total, source: `${str(frame.skill)} stage` };
  if (local.work?.sessionID === sessionID && local.work.planPath) {
    const plan = local.plans.find((entry) => local.work.planPath.endsWith(entry.path));
    if (plan && isRealCount(plan.done, plan.total)) return { done: plan.done, total: plan.total, source: "plan steps of the run" };
  }
  const open = local.plans.filter((entry) => entry.done < entry.total);
  if (open.length === 1 && isRealCount(open[0].done, open[0].total)) return { done: open[0].done, total: open[0].total, source: "plan steps" };
  if (local.goal && isRealCount(local.goal.done, local.goal.total)) return { done: local.goal.done, total: local.goal.total, source: "goal criteria" };
  const todos = detail.todos;
  if (todos.length > 0 && isRealCount(todos.filter((todo) => todo.status === "completed").length, todos.length)) {
    return { done: todos.filter((todo) => todo.status === "completed").length, total: todos.length, source: "todo list" };
  }
  return undefined;
}

// A liveness record written this long before the session's last stored move still describes that move.
const LIVENESS_SLACK_MS = 5000;

/**
 * The session's status from its records. A start-work run it completed (and did not move past) makes it
 * done; an idle or ended liveness record at least as new as its last move makes it idle, before the
 * two-minute guess. The session asking for the brief (`self`) is working whatever it last wrote.
 */
export function statusOf({ detail, local, sessionID, now, self = false }) {
  const pending = detail.tools.find((entry) => entry.tool === "question" && (entry.status === "running" || entry.status === "pending"));
  if (pending || (local.work?.sessionID === sessionID && local.work.status === "paused" && local.work.boundary)) return "waits-on-you";
  const latest = detail.tools[0];
  if (latest && latest.status === "error" && now - detail.updated > ACTIVE_WINDOW_MS) return "blocked";
  const stack = local.stacks.get(sessionID);
  if (stack?.frames?.some((entry) => isRecord(entry) && entry.status === "paused")) return "paused";
  if (self) return "working";
  const run = local.work?.sessionID === sessionID && local.work.status === "completed" ? local.work : undefined;
  if (run && Number.isFinite(run.updatedMs) && detail.updated <= run.updatedMs + LIVENESS_SLACK_MS) return "done";
  // An ended session (deleted in OpenCode) reads idle: nothing proves its work finished, only that it stopped.
  const live = local.liveness?.get(sessionID);
  if (live && live.state !== "alive" && live.atMs >= detail.updated - LIVENESS_SLACK_MS) return "idle";
  if (now - detail.updated <= ACTIVE_WINDOW_MS) return "working";
  const count = countChain({ sessionID, directory: detail.directory, local, detail });
  if (count && count.done === count.total) return "done";
  return "idle";
}

function nextOf(detail, local, status) {
  // A finished session's leftovers are history, never its next step.
  if (status === "done") return undefined;
  const todo = detail.todos.find((entry) => entry.status !== "completed" && entry.status !== "cancelled");
  if (todo) return clean(todo.content, 100);
  const open = local.plans.filter((entry) => entry.done < entry.total);
  if (open.length === 1) {
    const row = open[0].rows.find((entry) => !entry.done);
    if (row) return clean(row.title, 100);
  }
  if (local.goal?.open[0]) return clean(local.goal.open[0], 100);
  return undefined;
}

function doneOf(detail, local) {
  const finished = detail.todos.filter((entry) => entry.status === "completed").slice(-3).map((entry) => clean(entry.content, 80));
  if (finished.length > 0) return finished;
  if (local.goal?.closed.length) return local.goal.closed.slice(-2).map((entry) => clean(entry, 80));
  const sentence = detail.lastText.split(/\n/u).map((line) => line.trim()).find((line) => !line.startsWith("```") && /[\p{L}]{3}/u.test(line));
  if (sentence !== undefined) return [clean(sentence, 100)];
  return [];
}

// What a session touched, from its recent tool calls: edited files by base name, and the tools it used
// most. Only the newest parts are read, so tools are named, never counted in the brief.
function touchedOf(detail) {
  const edited = [];
  const uses = new Map();
  for (const entry of detail.tools) {
    const verb = TOOL_VERB[entry.tool] ?? entry.tool;
    if (verb) uses.set(verb, (uses.get(verb) ?? 0) + 1);
    const file = isRecord(entry.input) ? str(entry.input.filePath) : "";
    if ((entry.tool === "edit" || entry.tool === "write") && entry.status === "completed" && file !== "" && !edited.includes(basename(file))) edited.push(basename(file));
  }
  const tools = [...uses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([verb]) => verb);
  return { edited: edited.slice(0, 20).map((name) => clean(name, 60)), tools };
}

export function buildCard({ row, detail, local, lanes, now, self = false }) {
  const count = countChain({ sessionID: row.id, directory: row.directory, local, detail });
  const status = statusOf({ detail: { ...detail, updated: row.updated, directory: row.directory }, local, sessionID: row.id, now, self });
  const latest = detail.tools[0];
  const defaultTitle = /^(?:new session|child session|untitled)/iu.test(row.title) || row.title === "";
  const touched = touchedOf(detail);
  return {
    id: row.id,
    status,
    goal: clean(defaultTitle ? detail.firstPrompt || "(no title)" : row.title, 160),
    done: doneOf(detail, local),
    next: nextOf(detail, local, status) ?? null,
    edited: touched.edited,
    tools: touched.tools,
    ...(count ? { counts: count } : {}),
    facts: {
      steps: detail.steps,
      elapsedMin: Math.max(0, Math.round((row.updated - row.created) / 60_000)),
      ...(lanes > 0 ? { lanes } : {}),
      ...(latest ? { lastAction: lastActionOf(latest.tool, latest.input) } : {}),
    },
    updated: new Date(row.updated).toISOString(),
    boundary: local.work?.sessionID === row.id && local.work.boundary ? clean(local.work.boundary, 80) : undefined,
    parked: local.work?.sessionID === row.id && local.work.parked > 0 ? local.work.parked : undefined,
    ...(local.liveness?.get(row.id)?.pane ? { pane: local.liveness.get(row.id).pane } : {}),
  };
}

function roadmapOf(local) {
  const out = [];
  for (const commit of local.commits.slice(0, 3).reverse()) out.push({ mark: "✓", date: commit.at.slice(5, 10), text: commit.subject });
  const open = local.plans.filter((entry) => entry.done < entry.total);
  if (open.length === 1) {
    const upcoming = open[0].rows.filter((row) => !row.done);
    if (upcoming[0]) out.push({ mark: "▶", date: "now", text: clean(upcoming[0].title, 90) });
    for (const row of upcoming.slice(1, 3)) out.push({ mark: "○", date: "later", text: clean(row.title, 90) });
  }
  return out;
}

/**
 * Herdr agents at work beside this session, read only under HERDR_ENV=1: working or blocked, in this
 * herdr workspace or with a cwd inside one of `dirs`, never the asking pane. A failed, slow or malformed
 * `herdr agent list` reads "unknown" and counts no lane.
 */
export function readHerdrLanes(dirs, env = process.env) {
  if (env.HERDR_ENV !== "1") return { state: "off", agents: [] };
  let doc;
  try {
    doc = JSON.parse(execFileSync("herdr", ["agent", "list"], { encoding: "utf8", timeout: 3000, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024 }));
  } catch {
    return { state: "unknown", agents: [] };
  }
  const list = isRecord(doc) && isRecord(doc.result) && Array.isArray(doc.result.agents) ? doc.result.agents : undefined;
  if (list === undefined) return { state: "unknown", agents: [] };
  const inside = (cwd) => isAbsolute(str(cwd)) && dirs.some((dir) => {
    const rel = relative(dir, resolve(str(cwd)));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  const ownPane = str(env.HERDR_PANE_ID);
  const workspace = str(env.HERDR_WORKSPACE_ID);
  const agents = list
    .filter((entry) => isRecord(entry) && (entry.agent_status === "working" || entry.agent_status === "blocked"))
    .filter((entry) => ownPane === "" || str(entry.pane_id) !== ownPane)
    .filter((entry) => (workspace !== "" && str(entry.workspace_id) === workspace) || inside(entry.cwd) || inside(entry.foreground_cwd))
    .slice(0, 40)
    .map((entry) => ({ pane: clean(str(entry.pane_id), 32), status: entry.agent_status, session: isRecord(entry.agent_session) ? str(entry.agent_session.value) : "", title: clean(str(entry.terminal_title_stripped), 60) }));
  return { state: "read", agents };
}

/** Other working sessions here and herdr agents beside this one; a lane seen both ways counts once. */
export function laneCount({ groups, sessionID, herdr = [] }) {
  const cards = groups.flatMap((group) => group.sessions.map((card) => ({ card, group })));
  const working = cards.filter(({ card }) => card.status === "working" && card.id !== sessionID);
  const seen = new Set(working.flatMap(({ card }) => [card.id, card.pane].filter(Boolean)));
  const agents = herdr.filter((agent) => agent.session === "" || (agent.session !== sessionID && !seen.has(agent.session))).filter((agent) => !seen.has(agent.pane));
  return { working, agents, lanes: working.length + agents.length };
}

export function recommend({ groups, sessionID, herdr = [] }) {
  const cards = groups.flatMap((group) => group.sessions.map((card) => ({ card, group })));
  const waiting = cards.find(({ card }) => card.status === "waits-on-you");
  if (waiting) {
    const where = waiting.card.boundary ? `approve or deny ${waiting.card.boundary}` : "answer the open question";
    return { kind: "answer", sessionID: waiting.card.id, text: `In "${clip(waiting.card.goal, 50)}", ${where}.`, say: { goal: waiting.card.goal, boundary: waiting.card.boundary, own: waiting.card.id === sessionID } };
  }
  const blocked = cards.find(({ card }) => card.status === "blocked");
  if (blocked) return { kind: "session", sessionID: blocked.card.id, text: `Open "${clip(blocked.card.goal, 50)}": its last step failed and nothing has run since.`, say: { reason: "blocked", goal: blocked.card.goal } };
  // Lanes: other sessions at work here, and herdr agents beside this one; one seen both ways counts once.
  // They are counted before anything that resumes work here: while a lane runs, this session's own paused
  // frame and its own run are held, and only an approval (above) stays the user's call.
  const { working, agents, lanes } = laneCount({ groups, sessionID, herdr });
  const paused = cards.find(({ card }) => card.status === "paused" && !(lanes > 0 && card.id === sessionID));
  if (paused) {
    return paused.card.id === sessionID
      ? { kind: "continue", sessionID, text: `Return to the paused discipline in "${clip(paused.card.goal, 50)}" where it stopped.`, say: { goal: paused.card.goal } }
      : { kind: "session", sessionID: paused.card.id, text: `Open "${clip(paused.card.goal, 50)}" and say lit continue.`, say: { reason: "paused", goal: paused.card.goal } };
  }
  if (lanes > 0) {
    const plural = `${lanes} lane${lanes === 1 ? "" : "s"}`;
    const waiting = agents.find((agent) => agent.status === "blocked");
    const first = working[0];
    const doing = first?.card.facts.lastAction ? ` (now: ${first.card.facts.lastAction})` : "";
    const what = first ? `"${clip(first.card.goal, 50)}" in ${first.group.worktree} is still running${doing}` : `${agents[0].title || "an agent"} in pane ${agents[0].pane}`;
    const text = waiting
      ? `A lane waits on you: answer the one waiting on you in pane ${waiting.pane}, then wait for ${plural} to finish before starting more.`
      : `Wait for ${plural} to finish before starting more: ${what}.`;
    const lane = first ? first.card.goal : agents[0].title || `pane ${agents[0].pane}`;
    return { kind: "lanes", sessionID: first?.card.id ?? sessionID, lanes, text, short: waiting ? `answer pane ${waiting.pane}, then wait for ${plural}` : `wait for ${plural} to finish`, say: { lane, lanes, pane: waiting?.pane } };
  }
  const run = groups.find((group) => group.work?.status === "active");
  if (sessionID !== undefined && run?.work.sessionID === sessionID) return { kind: "work", sessionID, text: "Keep the running start-work run going from its checked plan.", say: {} };
  // Another session's active run is followed from that session, never started again here.
  if (run) return { kind: "session", sessionID: run.work.sessionID || undefined, text: `start-work on ${run.work.plan || "its plan"} is running in another session; open that session to follow it.`, say: { reason: "run-elsewhere", plan: run.plans.find((plan) => run.work.plan.endsWith(plan.path))?.title || basename(run.work.plan || "its plan") } };
  const here = groups.find((group) => group.current);
  const open = here?.plans.filter((plan) => plan.done < plan.total) ?? [];
  if (open.length === 1) return { kind: "plan", sessionID, target: open[0].path, text: `Start work on ${open[0].path}: ${open[0].total - open[0].done} step${open[0].total - open[0].done === 1 ? "" : "s"} left.`, say: { plan: open[0].title, left: open[0].total - open[0].done } };
  // With nothing for go to run here, this worktree's own HANDOFF.md Next item comes before older sessions.
  if (here?.handoffNext) return { kind: "handoff", sessionID, text: `From HANDOFF.md: ${clip(here.handoffNext, 100)}`, short: clip(here.handoffNext, 60), say: { item: here.handoffNext } };
  const unfinished = cards.find(({ card }) => card.status === "idle" && card.next);
  if (unfinished) return { kind: "session", sessionID: unfinished.card.id, text: `Pick up "${clip(unfinished.card.goal, 50)}": next is ${clip(unfinished.card.next, 60)}.`, say: { reason: "unfinished", goal: unfinished.card.goal, next: unfinished.card.next } };
  // Nothing can run on go, so the box still names a real step from the records: an open plan in another
  // worktree, else the most recent session that stopped, else what to do with an empty window.
  for (const group of groups.filter((entry) => !entry.current)) {
    const elsewhere = group.plans.filter((plan) => plan.done < plan.total);
    if (elsewhere.length === 1 && elsewhere[0].next) return { kind: "suggest", sessionID, text: `Next in ${group.worktree}/${elsewhere[0].path}: ${clip(elsewhere[0].next, 60)}.`, short: `${clip(elsewhere[0].next, 40)} (${group.worktree})`, say: { item: elsewhere[0].next, worktree: group.worktree } };
  }
  const stopped = cards.find(({ card }) => card.id !== sessionID && (card.status === "idle" || card.status === "done"));
  if (stopped) return { kind: "session", sessionID: stopped.card.id, text: `Pick up "${clip(stopped.card.goal, 50)}" in ${stopped.group.worktree}${stopped.card.status === "done" ? ": it finished; check the result" : ""}.`, say: { reason: stopped.card.status === "done" ? "finished" : "stopped", goal: stopped.card.goal, worktree: stopped.group.worktree } };
  return { kind: "none", sessionID, text: "No earlier session or open plan here: say what to start.", say: {} };
}

export function writeNext(root, record) {
  if (!SAFE_SESSION.test(record.sessionID)) return false;
  const dir = join(root, ".litopencode", "adhd");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `next-${record.sessionID}.json`);
  try {
    if (!lstatSync(file).isFile()) return false;
  } catch {
    // no earlier record
  }
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ schema: NEXT_SCHEMA, ...record }), { mode: 0o600 });
  renameSync(temp, file);
  return true;
}

export async function collect(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const now = options.now ?? Date.now();
  budget.left = Math.min(TOTAL_BYTE_BUDGET, Math.max(1, Number.isInteger(options.budgetBytes) ? options.budgetBytes : TOTAL_BYTE_BUDGET));
  budget.skipped = 0;
  const family = options.allDirs ? [] : worktreeFamily(root);
  const dirs = family.map((entry) => resolve(entry.dir));
  const limit = Math.min(Math.max(options.maxSessions ?? 10, 1), 30);
  // The small local records first (plans, goal, run, stacks, liveness, handoff): the session store read
  // after them may use up the read budget. A plan outside the window is left out, here or elsewhere.
  const locals = family.map((entry) => {
    const dir = resolve(entry.dir);
    const local = readLocalState(dir);
    // An open plan outside the window is history for the roadmap, and one reminder line on the board.
    local.stale = local.plans.filter((plan) => !plan.complete && now - plan.changedMs > PLAN_WINDOW_MS);
    local.plans = local.plans.filter((plan) => now - plan.changedMs <= PLAN_WINDOW_MS);
    return { entry, dir, local };
  });
  const dataHome = process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  const dbFile = options.db ?? join(dataHome, "opencode", "opencode.db");
  let store = lstatOk(dbFile) ? await openSqlite(dbFile) : { error: "no session database was found" };
  if (store.error) {
    const legacy = openLegacy(options.storage ?? join(dataHome, "opencode", "storage"));
    store = legacy.error ? { ...store, error: `${store.error}; ${legacy.error}` } : legacy;
  }
  const herdr = readHerdrLanes(dirs.length > 0 ? dirs : [root], options.env ?? process.env);
  const report = { schema: REWIND_SCHEMA, generatedAt: new Date(now).toISOString(), root: clean(root, 200), source: { store: store.kind ?? "none", ...(store.error ? { note: store.error } : {}), ...(herdr.state === "off" ? {} : { herdr: herdr.state }) }, groups: [] };
  const rows = store.kind ? store.sessions(dirs, limit) : [];
  const lanes = store.kind ? store.lanes(rows.map((row) => row.id)) : new Map();
  for (const { entry, dir, local } of locals) {
    const sessions = rows.filter((row) => resolve(row.directory) === dir).map((row) => buildCard({ row, detail: store.detail(row), local, lanes: lanes.get(row.id) ?? 0, now, self: row.id === options.session }));
    if (sessions.length === 0 && local.plans.length === 0 && local.work === undefined && local.handoffNext === undefined) continue;
    const run = local.work?.status === "completed" && local.work.plan !== "" && now - local.work.updatedMs <= PLAN_WINDOW_MS ? local.work.plan : undefined;
    report.groups.push({
      worktree: clean(basename(dir), 60),
      branch: clean(entry.branch, 60),
      current: dir === root,
      sessions,
      plans: local.plans.map(({ path, title, done, total, rows, complete }) => ({ path, title: clean(title, 80), done, total, complete, next: clean(rows.find((entry) => !entry.done)?.title ?? "", 90) })),
      work: local.work ? { sessionID: local.work.sessionID, status: local.work.status, plan: clean(local.work.plan, 90) } : undefined,
      handoff: local.handoff,
      ...(local.handoffNext === undefined ? {} : { handoffNext: local.handoffNext }),
      roadmap: roadmapOf(local),
      // Finished inside the window, for the brief's opener: commits, a completed start-work run, ticked plans and a met goal.
      finished: {
        commits: local.commits.filter((commit) => now - Date.parse(commit.at) <= PLAN_WINDOW_MS).slice(0, 2).map((commit) => commit.subject),
        runs: run === undefined ? [] : [clean(run, 90)],
        plans: local.plans.filter((plan) => plan.complete).map(({ path, done, total }) => ({ path, done, total })),
        ...(local.goal && local.goal.total > 0 && local.goal.done === local.goal.total && local.goal.title ? { goal: clean(local.goal.title, 100) } : {}),
      },
    });
  }
  report.plansSkipped = locals.reduce((total, { local }) => total + local.plansSkipped, 0);
  report.recommended = recommend({ groups: report.groups, sessionID: options.session, herdr: herdr.agents });
  const all = report.groups.flatMap((group) => group.sessions);
  const waits = all.filter((card) => card.status === "waits-on-you").length;
  report.headline = all.length === 0
    ? "No earlier sessions found here"
    : `${all.length} session${all.length === 1 ? "" : "s"} · ${waits} waiting on you · ${all.filter((card) => card.status === "working").length} active · next: ${clip(report.recommended.short ?? report.recommended.text, 70)}`;
  report.nextRecord = null;
  const kind = report.recommended.kind;
  const forThisSession = options.session !== undefined && report.recommended.sessionID === options.session;
  if (options.writeNext && forThisSession && (kind === "continue" || kind === "work" || kind === "plan")) {
    const record = { kind, target: report.recommended.target ?? kind, at: now, sessionID: options.session };
    if (writeNext(root, record)) report.nextRecord = { kind, target: record.target };
  } else if (options.writeNext && options.session !== undefined && kind !== "none" && kind !== "handoff" && kind !== "lanes") {
    // The step belongs to another session or worktree: go here cannot run it, so it answers with where to go.
    const record = { kind: "elsewhere", target: clip(report.recommended.text, 300), at: now, sessionID: options.session };
    if (writeNext(root, record)) report.nextRecord = { kind: "elsewhere", target: record.target };
  }
  report.board = buildBoard({ report, locals, root, sessionID: options.session, herdr: herdr.agents, now });
  return report;
}

function lstatOk(file) {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Brief, shape B, in Markdown so OpenCode's chat draws it with colour: a headline, live sessions as
// cards grouped by worktree and branch, ended sessions folded into one table, the roadmap, one boxed
// recommendation and `go`. `--ascii` swaps every emoji and box glyph for a plain character.

const BADGE = {
  "working": ["🟢", "*", "ACTIVE"],
  "waits-on-you": ["🟠", "!", "WAITS ON YOU"],
  "blocked": ["🔴", "x", "BLOCKED"],
  "paused": ["⏸️", "=", "PAUSED"],
  "done": ["✅", "v", "DONE"],
  "idle": ["⚪", "o", "IDLE"],
};
const LIVE = new Set(["working", "waits-on-you", "blocked", "paused"]);

// Inline code that a backtick in the data cannot break, and one line of data as Markdown text.
const code = (text) => `\`${String(text).replace(/`/gu, "'")}\``;
const md = (text) => String(text).replace(/\s+/gu, " ").trim().replace(/[<>`]/gu, (ch) => ({ "<": "‹", ">": "›", "`": "'" })[ch]).replace(/[*_|[\]\\]/gu, (ch) => `\\${ch}`);
const shortId = (id) => String(id).replace(/^ses_/u, "").slice(-8);
const agoOf = (iso, now) => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return undefined;
  return now - at < 60_000 ? "just now" : `${elapsedWords((now - at) / 60_000)} ago`;
};

// Wraps the step to the box at word breaks, three lines at most, the last one cut.
function wrapCells(text, width, most = 3) {
  const out = [""];
  for (const word of String(text).replace(/\s+/gu, " ").trim().split(" ")) {
    const joined = out.at(-1) ? `${out.at(-1)} ${word}` : word;
    if (cellWidth(joined) <= width || !out.at(-1)) out[out.length - 1] = joined;
    else out.push(word);
  }
  const kept = out.slice(0, most);
  if (out.length > most) kept[most - 1] = `${kept[most - 1]} ${out.slice(most).join(" ")}`;
  return kept.map((line) => cutCells(line, width));
}

function cardLines(card, now, sessionID, ascii) {
  const [emoji, plainMark, word] = BADGE[card.status] ?? BADGE.idle;
  const ago = agoOf(card.updated, now);
  const head = `${ascii ? `[${plainMark}]` : emoji} **${word}** · ${code(shortId(card.id))}${ago ? ` · ${ago}` : ""}${card.id === sessionID ? " · this session" : ""}${card.boundary ? ` · waits for approval of ${md(card.boundary)}` : ""}${card.parked ? ` · ${card.parked} parked (lit approve optional)` : ""}`;
  const lines = [head, `**${md(cutCells(card.goal, 100))}**`];
  const bar = card.counts ? gauge(card.counts.done, card.counts.total, { ascii }) : undefined;
  const hourglass = ascii ? "~" : "⏳";
  if (bar) lines.push(`${code(bar)} ${md(card.counts.source)} · ${md(factsLine(card.facts))}`);
  else lines.push(`${hourglass} ${md(factsLine(card.facts))}${card.status === "working" ? ` ${code(pulse(ascii))}` : ""}`);
  const done = card.done.length > 0
    ? card.done.map(md).join(" · ")
    : (card.edited ?? []).length > 0
      ? `edited ${card.edited.slice(0, 3).map(code).join(", ")}${card.edited.length > 3 ? ` (+${card.edited.length - 3})` : ""}`
      : (card.tools ?? []).length > 0 ? `no edits yet; used ${card.tools.map(md).join(", ")}` : "nothing recorded yet";
  lines.push(`${ascii ? "+" : "✅"} Done: ${cutCells(done, 110)}`);
  const next = card.next ? md(card.next) : card.status === "working" && card.facts.lastAction ? `now: ${md(card.facts.lastAction)}` : "nothing pending on record";
  lines.push(`${ascii ? ">" : "▶"} Next: ${cutCells(next, 110)}`);
  // A hard line break after every line but the last keeps the card's lines apart inside one quote.
  return lines.map((line, index) => `> ${line}${index < lines.length - 1 ? "  " : ""}`);
}

function endedTable(rows, now) {
  const cell = (text) => md(text) || "·";
  const body = rows.slice(0, ENDED_ROWS).map(({ card, group }) => {
    const at = Date.parse(card.updated);
    const age = Number.isFinite(at) ? (elapsedWords((now - at) / 60_000) ?? "0m").split(" ")[0] : "·";
    const edits = (card.edited ?? []).length;
    const done = card.status === "done" ? "finished" : edits > 0 ? `${edits} file${edits === 1 ? "" : "s"}` : "·";
    return `| ${code(shortId(card.id))} | ${cell(cutCells(group.worktree, 20))} | ${cell(cutCells(card.goal, 44))} | ${age} | ${done} |`;
  });
  const more = rows.length > ENDED_ROWS ? ["", `*…and ${rows.length - ENDED_ROWS} more ended*`] : [];
  return ["| id | where | goal | ago | done |", "|---|---|---|---|---|", ...body, ...more];
}

// The three lines that open the brief, from records only. Done: this worktree's newest commits in the
// window (two at most), its completed start-work run and its fully ticked plans (three items in all),
// else its met goal. Doing: this session's own frame or goal while it works, else the running start-work
// run, else the newest working session. Next: the recommended step, with the word to type when go runs it.
function openerLines(report, sessionID, runsHere) {
  const here = report.groups.find((group) => group.current);
  const finished = here?.finished;
  const runs = new Set(finished?.runs ?? []);
  const items = [
    ...(finished?.commits ?? []).map(md),
    ...[...runs].map((plan) => `${code(plan)} (start-work complete)`),
    ...(finished?.plans ?? []).filter((plan) => !runs.has(plan.path)).map((plan) => `${code(plan.path)} ${code(gauge(plan.done, plan.total) ?? `${plan.done}/${plan.total}`)}`),
  ].slice(0, 3);
  const done = items.length > 0 ? items.join("; ") : finished?.goal ? md(finished.goal) : "nothing finished in this window";
  const cards = report.groups.flatMap((group) => group.sessions);
  const self = cards.find((card) => card.id === sessionID && card.status === "working");
  const running = here?.work?.status === "active" ? here.work.plan : undefined;
  const newest = cards.filter((card) => card.status === "working").sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
  const doing = self ? md(cutCells(self.goal, 80)) : running !== undefined ? ["start-work", running].filter(Boolean).map(md).join(" · ") : newest ? md(cutCells(newest.goal, 80)) : "nothing running";
  const step = md(cutCells(report.recommended.short ?? report.recommended.text, 90));
  return [`**Done so far:** ${cutCells(done, 100)}  `, `**Doing now:** ${doing}  `, `**Next:** ${step}${runsHere ? " (type `go`)" : ""}`];
}

export function renderDetail(report, { ascii = false, width = 72, sessionID } = {}) {
  const glyph = (fancy, plain) => (ascii ? plain : fancy);
  const now = Date.parse(report.generatedAt) || Date.now();
  const runsHere = Boolean(report.nextRecord && report.nextRecord.kind !== "elsewhere");
  const lines = [...openerLines(report, sessionID, runsHere), "", `## ${glyph("🧭 ", "")}${md(cutCells(report.headline, 110))}`];
  const worktrees = report.groups.length;
  lines.push(`*this worktree family · ${worktrees} worktree${worktrees === 1 ? "" : "s"} with records${report.source.note ? ` · ${md(report.source.note)}` : ""}*`);
  const ended = [];
  for (const group of report.groups) {
    for (const card of group.sessions.filter((entry) => !LIVE.has(entry.status))) ended.push({ card, group });
    const live = group.sessions.filter((entry) => LIVE.has(entry.status));
    if (live.length === 0) continue;
    lines.push("", `### ${glyph("🌿 ", "")}${code(group.branch || "(no branch)")} · ${md(group.worktree)}${group.current ? " (this one)" : ""}`);
    for (const card of live) lines.push("", ...cardLines(card, now, sessionID, ascii));
  }
  if (ended.length > 0) {
    ended.sort((a, b) => Date.parse(b.card.updated) - Date.parse(a.card.updated));
    lines.push("", `### ${glyph("⚪ ", "")}Ended · ${ended.length}`, "", ...endedTable(ended, now));
  }
  const roadmap = report.groups.filter((group) => group.roadmap.length > 0);
  if (roadmap.length > 0) {
    lines.push("", `### ${glyph("🗺️ ", "")}Roadmap`, "");
    for (const group of roadmap) {
      const where = group.current ? "" : `${code(group.worktree)} `;
      for (const item of group.roadmap) {
        const mark = glyph(item.mark, { "✓": "v", "▶": ">", "○": "o" }[item.mark]);
        lines.push(`- ${mark} ${item.date === "now" || item.date === "later" ? `**${item.date}**` : item.date} · ${where}${md(item.text)}`);
      }
    }
  }
  const inner = width - 4;
  const title = " Recommended next step ";
  // An untagged fence: a language tag would make the chat colour the box as code.
  lines.push("", "```");
  lines.push(`${glyph("╭─", "+-")}${title}${glyph("─", "-").repeat(Math.max(1, inner + 1 - cellWidth(title)))}${glyph("╮", "+")}`);
  for (const text of wrapCells(report.recommended.text, inner)) lines.push(`${glyph("│", "|")} ${padCells(text, inner)} ${glyph("│", "|")}`);
  if (runsHere) lines.push(`${glyph("│", "|")} ${padCells("type: go", inner)} ${glyph("│", "|")}`);
  lines.push(`${glyph("╰", "+")}${glyph("─", "-").repeat(inner + 2)}${glyph("╯", "+")}`, "```", "");
  lines.push(runsHere ? "Type **`go`** to do it." : report.recommended.kind === "lanes" ? "Do not type `go` until they finish." : report.nextRecord ? "Nothing runs on its own here: open that session, or say what to do (`go` says where)." : "Nothing runs on its own here: open that session, or say what to do.");
  if (report.plansSkipped > 0) lines.push("", `*${report.plansSkipped} ${report.plansSkipped === 1 ? "plan was" : "plans were"} not read (read budget used up).*`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// The KPI board, the default brief: the one step to take now and what to type, four bucket counts and an
// overall bar, milestones, what was done lately, what is left, and action-shaped reminders. Every figure is
// computed here from the records above; the model shows the text as given.

const BOARD_DONE = 5;
const BOARD_LEFT = 7;
const BOARD_MILESTONES = 4;
const BOARD_REMINDERS = 5;
const BOARD_STALE = 2;
const BUCKETS = ["waiting", "active", "todo", "done"];

/** Ten cells of █ and ░ (or # and - under --ascii), then `k/n (p%)`; nothing without a real total. */
export function kpiBar(done, total, { ascii = false, cells = 10 } = {}) {
  if (!isRealCount(done, total)) return undefined;
  const filled = Math.min(cells, Math.round((done / total) * cells));
  return `${(ascii ? "#" : "█").repeat(filled)}${(ascii ? "-" : "░").repeat(cells - filled)} ${done}/${total} (${Math.round((done / total) * 100)}%)`;
}

// A checklist row as a plain sentence: its own numbering goes, the list numbers it again.
const plainRow = (title) => clean(String(title).replace(/^\d+[.)]\s+/u, ""), 90);

export function buildBoard({ report, locals, root, sessionID, herdr = [], now }) {
  const tiles = { done: 0, active: 0, waiting: 0, left: 0 };
  const milestones = [];
  const doneItems = [];
  const leftItems = [];
  const counted = new Set();
  const ordered = [...locals].sort((a, b) => Number(b.dir === root) - Number(a.dir === root));
  for (const { dir, local } of ordered) {
    const current = dir === root;
    const worktree = current ? undefined : clean(basename(dir), 60);
    const run = local.work;
    for (const plan of [...local.plans].sort((a, b) => b.changedMs - a.changedMs)) {
      const ofRun = run !== undefined && run.planPath !== "" && run.planPath.endsWith(plan.path);
      const bucket = plan.complete ? "done" : ofRun && run.status === "paused" && run.boundary ? "waiting" : (ofRun && run.status === "active") || plan.done > 0 ? "active" : "todo";
      if (bucket === "waiting") counted.add(run.sessionID);
      milestones.push({ title: clean(plan.title, 80), ...(worktree ? { worktree } : {}), bucket, done: plan.done, total: plan.total, changedMs: plan.changedMs, first: ofRun && run.status !== "completed" });
      plan.rows.forEach((row, index) => {
        if (row.done) doneItems.push({ text: plainRow(row.title), at: plan.changedMs, index });
      });
      const open = plan.rows.filter((row) => !row.done).map((row) => plainRow(row.title));
      leftItems.push({ first: ofRun && run.status !== "completed", current, at: plan.changedMs, rows: open });
      tiles.done += plan.done;
      if (bucket === "waiting") tiles.waiting += 1;
      if (bucket === "active") tiles.active += 1;
      tiles.left += open.length - (bucket === "waiting" || bucket === "active" ? 1 : 0);
    }
    if (run?.status === "completed" && run.plan !== "" && now - run.updatedMs <= PLAN_WINDOW_MS) {
      const plan = local.plans.find((entry) => run.planPath.endsWith(entry.path));
      doneItems.push({ text: clean(`start-work finished: ${plan?.title ?? basename(run.plan)}`, 90), at: run.updatedMs, index: Number.MAX_SAFE_INTEGER });
    }
    const goal = local.goal;
    if (goal && goal.total > 0) {
      const bucket = goal.done === goal.total ? "done" : goal.done > 0 ? "active" : "todo";
      milestones.push({ title: clean(goal.title || "Goal", 80), ...(worktree ? { worktree } : {}), bucket, done: goal.done, total: goal.total, changedMs: local.goalChangedMs, first: false });
      goal.closed.forEach((text, index) => doneItems.push({ text: clean(text, 90), at: local.goalChangedMs, index }));
      leftItems.push({ first: false, current, at: local.goalChangedMs, rows: goal.open.map((text) => clean(text, 90)) });
      tiles.done += goal.done;
      if (bucket === "active") tiles.active += 1;
      tiles.left += goal.total - goal.done - (bucket === "active" ? 1 : 0);
    }
  }
  const cards = report.groups.flatMap((group) => group.sessions);
  const waitingCards = cards.filter((card) => card.status === "waits-on-you");
  const blockedAgents = herdr.filter((agent) => agent.status === "blocked" && agent.session !== sessionID);
  tiles.waiting += waitingCards.filter((card) => !counted.has(card.id)).length + blockedAgents.length;

  const reminders = [];
  for (const card of waitingCards) reminders.push({ kind: "waiting", goal: clip(card.goal, 40), ...(card.boundary ? { boundary: card.boundary, own: card.id === sessionID } : {}) });
  for (const agent of blockedAgents) reminders.push({ kind: "waiting", pane: agent.pane });
  const { lanes } = laneCount({ groups: report.groups, sessionID, herdr });
  if (lanes > 0) reminders.push({ kind: "lanes", count: lanes });
  for (const { dir, local } of ordered) if (local.dirty > 0) reminders.push({ kind: "uncommitted", count: local.dirty, worktree: clean(basename(dir), 40) });
  for (const { dir, local } of ordered) if (local.ahead > 0) reminders.push({ kind: "unpushed", count: local.ahead, worktree: clean(basename(dir), 40) });
  const stale = ordered.flatMap(({ local }) => local.stale ?? []).sort((a, b) => b.changedMs - a.changedMs).slice(0, BOARD_STALE);
  for (const plan of stale) reminders.push({ kind: "stale", days: Math.floor((now - plan.changedMs) / (24 * 60 * 60_000)), title: clip(clean(plan.title, 80), 50) });
  const here = report.groups.find((group) => group.current);
  if (here?.handoffNext && report.recommended.kind !== "handoff") reminders.push({ kind: "handoff", item: clip(here.handoffNext, 60) });

  milestones.sort((a, b) => Number(b.first) - Number(a.first) || BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || b.changedMs - a.changedMs);
  doneItems.sort((a, b) => b.at - a.at || b.index - a.index);
  const left = leftItems.sort((a, b) => Number(b.first) - Number(a.first) || Number(b.current) - Number(a.current) || b.at - a.at).flatMap((entry) => entry.rows);
  return {
    now: { kind: report.recommended.kind, ...(report.recommended.say ?? {}), armed: Boolean(report.nextRecord && report.nextRecord.kind !== "elsewhere") },
    tiles,
    overall: { done: tiles.done, total: tiles.done + tiles.active + tiles.waiting + tiles.left },
    milestones: milestones.map(({ first, ...rest }) => rest),
    doneLately: doneItems.slice(0, BOARD_DONE).map((item) => item.text),
    doneMore: Math.max(0, doneItems.length - BOARD_DONE),
    remaining: left.slice(0, BOARD_LEFT),
    remainingMore: Math.max(0, left.length - BOARD_LEFT),
    reminders: reminders.slice(0, BOARD_REMINDERS),
  };
}

const LABELS = {
  en: {
    now: "Do this now", glance: "At a glance", milestones: "Milestones", done: "Done lately", left: "Still to do", forget: "Don't forget",
    type: "Type", wait: "Wait", tiles: ["Done", "In progress", "Waiting on you", "Left"], overall: "Overall", noOverall: "no checklist on record yet",
    columns: ["Milestone", "Status", "Progress", "Last move"], status: { done: "Done", active: "In progress", waiting: "Waiting on you", todo: "Not started" },
    empty: { milestones: "No open plan or goal", done: "Nothing finished lately", left: "Nothing left", forget: "Nothing to remember" },
    more: (n) => `…and ${n} more`, detail: "Session detail",
    ago: (minutes) => (minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`),
  },
  ko: {
    now: "지금 할 일", glance: "한눈에 보기", milestones: "마일스톤", done: "최근 끝낸 일", left: "남은 일", forget: "잊지 말 것",
    type: "입력", wait: "기다리기", tiles: ["끝남", "진행 중", "나를 기다림", "남음"], overall: "전체 진행", noOverall: "아직 기록된 체크리스트가 없어요",
    columns: ["마일스톤", "상태", "진행", "최근"], status: { done: "끝남", active: "진행 중", waiting: "나를 기다림", todo: "시작 전" },
    empty: { milestones: "열린 계획이나 목표가 없어요", done: "최근 끝낸 일이 없어요", left: "남은 일이 없어요", forget: "잊지 말 것이 없어요" },
    more: (n) => `…외 ${n}개`, detail: "세션 자세히",
    ago: (minutes) => (minutes < 1 ? "방금" : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`),
  },
};
export const BOARD_LANGS = Object.keys(LABELS);

const BUCKET_ICON = { done: ["✅", "[v]"], active: ["🔄", "[~]"], waiting: ["⏳", "[!]"], todo: ["⬜", "[ ]"] };
const SECTION_ICON = { now: "🎯", glance: "📊", milestones: "🏁", done: "✅", left: "⬜", forget: "🔔" };
const REMINDER_ICON = { waiting: ["⏳", "!"], lanes: ["🏃", ">"], uncommitted: ["💾", "*"], unpushed: ["⬆️", "^"], stale: ["🕰️", "~"], handoff: ["📌", "#"] };

const q = (text, cells = 40) => `"${md(cutCells(text, cells))}"`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The step in plain words, one reason and the exact text to type. Kinds and their order come from
// recommend(); only the wording lives here.
function nowLines(step, lang) {
  const ko = lang === "ko";
  const c = (text) => code(text);
  const go = step.armed ? c("go") : undefined;
  const say = (en, kr) => (ko ? kr : en);
  switch (step.kind) {
    case "answer":
      return step.boundary
        ? { action: say(`Approve or deny ${md(step.boundary)} in ${q(step.goal)}`, `${q(step.goal)}에서 ${md(step.boundary)} 승인 또는 거절하기`), why: say("the run stays stopped until you decide", "결정할 때까지 실행이 멈춰 있어요"), type: step.own ? say(`${c("lit approve")} or ${c("lit deny")}`, `${c("lit approve")} 또는 ${c("lit deny")}`) : say(`open that session, then ${c("lit approve")} or ${c("lit deny")}`, `그 세션을 열고 ${c("lit approve")} 또는 ${c("lit deny")}`) }
        : { action: say(`Answer the question in ${q(step.goal)}`, `${q(step.goal)}의 질문에 답하기`), why: say("that session is stopped until you reply", "답할 때까지 그 세션이 멈춰 있어요"), type: say("open that session and reply there", "그 세션을 열고 거기서 답하기") };
    case "continue":
      return { action: say(`Return to the paused work in ${q(step.goal)}`, `${q(step.goal)}의 멈춘 작업으로 돌아가기`), why: say("it kept its place and its count", "멈춘 자리와 진행 수를 그대로 기억해요"), type: go ?? c("lit continue") };
    case "lanes":
      return step.pane
        ? { action: say(`Answer the agent waiting in pane ${md(step.pane)}`, `${md(step.pane)} 창에서 기다리는 에이전트에 답하기`), why: say(`then let ${plural(step.lanes, "lane")} finish`, `그다음 레인 ${step.lanes}개가 끝나길 기다려요`), type: say(`open pane ${md(step.pane)} and reply there`, `${md(step.pane)} 창을 열고 답하기`) }
        : { action: say(`Wait for ${plural(step.lanes, "lane")} to finish`, `레인 ${step.lanes}개가 끝날 때까지 기다리기`), why: say("starting more now would run into them", "지금 새로 시작하면 서로 부딪혀요"), wait: say(`until ${q(step.lane)} finishes`, `${q(step.lane)} 끝날 때까지`) };
    case "work":
      return { action: say("Keep the start-work run going", "start-work 실행 이어 가기"), why: say("it is running from its checked plan", "체크된 계획대로 돌고 있어요"), type: go ?? say("keep this session open", "이 세션을 그대로 두기") };
    case "plan":
      return { action: say(`Start the plan ${q(step.plan, 50)}`, `${md(cutCells(step.plan, 50))} 계획 시작하기`), why: say(`${plural(step.left, "step")} left`, `남은 단계 ${step.left}개`), type: go ?? c("start-work") };
    case "handoff":
      return { action: md(cutCells(step.item, 70)), why: say("the next item in HANDOFF.md", "HANDOFF.md의 다음 항목이에요"), type: say(`tell me to start it; ${c("go")} does not run it`, `시작하라고 말하기 (${c("go")}로는 시작하지 않아요)`) };
    case "suggest":
      return { action: md(cutCells(step.item, 70)), why: say(`the open plan in ${md(step.worktree)}`, `${md(step.worktree)}의 열린 계획이에요`), type: say(`open ${md(step.worktree)}`, `${md(step.worktree)} 열기`) };
    case "session": {
      const open = say("open that session", "그 세션 열기");
      if (step.reason === "blocked") return { action: say(`Open ${q(step.goal)}`, `${q(step.goal)} 세션 열어 보기`), why: say("its last step failed and nothing has run since", "마지막 단계가 실패한 뒤 멈춰 있어요"), type: open };
      if (step.reason === "paused") return { action: say(`Return to ${q(step.goal)}`, `${q(step.goal)}로 돌아가기`), why: say("its work is paused where it stopped", "멈춘 자리에서 쉬고 있어요"), type: say(`open that session, then ${c("lit continue")}`, `그 세션을 열고 ${c("lit continue")}`) };
      if (step.reason === "run-elsewhere") return { action: say(`Follow start-work on ${q(step.plan)}`, `${q(step.plan)} start-work 지켜보기`), why: say("it is running in another session", "다른 세션에서 돌고 있어요"), type: open };
      if (step.reason === "unfinished") return { action: say(`Pick up ${q(step.goal)}`, `${q(step.goal)} 이어 하기`), why: say(`next: ${md(cutCells(step.next, 50))}`, `다음: ${md(cutCells(step.next, 50))}`), type: open };
      if (step.reason === "finished") return { action: say(`Check the result of ${q(step.goal)}`, `${q(step.goal)} 결과 확인하기`), why: say("it finished; only the result needs a look", "끝났으니 결과만 보면 돼요"), type: open };
      return { action: say(`Pick up ${q(step.goal)}`, `${q(step.goal)} 이어 하기`), why: say(`it stopped in ${md(step.worktree ?? "")}`, `${md(step.worktree ?? "")}에서 멈췄어요`), type: open };
    }
    default:
      return { action: say("Say what to start", "무엇을 시작할지 말하기"), why: say("no open plan, goal or earlier session is on record here", "여기엔 아직 열린 계획이나 이전 세션 기록이 없어요"), type: say("say it in your own words", "하고 싶은 일을 말하기") };
  }
}

function reminderLine(entry, lang, ascii) {
  const ko = lang === "ko";
  const say = (en, kr) => (ko ? kr : en);
  const arrow = ascii ? "->" : "→";
  const [icon, plain] = REMINDER_ICON[entry.kind];
  let body;
  if (entry.kind === "waiting" && entry.pane) body = say(`the agent in pane ${md(entry.pane)} waits on you ${arrow} answer it in that pane`, `${md(entry.pane)} 창의 에이전트가 기다려요 ${arrow} 그 창에서 답하기`);
  else if (entry.kind === "waiting" && entry.boundary) body = say(`${q(entry.goal)} waits for approval of ${md(entry.boundary)} ${arrow} ${entry.own ? "" : "in that session, "}type ${code("lit approve")} or ${code("lit deny")}`, `승인 대기: ${q(entry.goal)} (${md(entry.boundary)}) ${arrow} ${entry.own ? "" : "그 세션에서 "}${code("lit approve")} 또는 ${code("lit deny")} 입력`);
  else if (entry.kind === "waiting") body = say(`${q(entry.goal)} asks you a question ${arrow} open that session and answer it`, `질문 대기: ${q(entry.goal)} ${arrow} 그 세션을 열고 답하기`);
  else if (entry.kind === "lanes") body = say(`${plural(entry.count, "lane")} still working ${arrow} don't type ${code("go")} until ${entry.count === 1 ? "it finishes" : "they finish"}`, `아직 일하는 레인 ${entry.count}개 ${arrow} 끝날 때까지 ${code("go")} 치지 않기`);
  else if (entry.kind === "uncommitted") body = say(`${entry.count} uncommitted change${entry.count === 1 ? "" : "s"} (${md(entry.worktree)}) ${arrow} review them, then commit or discard`, `커밋 안 된 변경 ${entry.count}개 (${md(entry.worktree)}) ${arrow} 확인하고 커밋하거나 되돌리기`);
  else if (entry.kind === "unpushed") body = say(`${plural(entry.count, "commit")} not pushed (${md(entry.worktree)}) ${arrow} push when you are ready`, `푸시 안 한 커밋 ${entry.count}개 (${md(entry.worktree)}) ${arrow} 준비되면 푸시하기`);
  else if (entry.kind === "stale") body = say(`Plan untouched for ${entry.days} days: ${md(entry.title)} ${arrow} decide whether to resume or drop it`, `${entry.days}일째 멈춘 계획: ${md(entry.title)} ${arrow} 이어 할지, 접을지 정하기`);
  else body = say(`HANDOFF.md next: ${md(entry.item)} ${arrow} start it when you are ready`, `HANDOFF.md 다음 할 일: ${md(entry.item)} ${arrow} 준비되면 시작하기`);
  return cutCells(`- ${ascii ? plain : icon} ${body}`, 118);
}

export function renderBoard(report, { ascii = false, lang = "en" } = {}) {
  const L = LABELS[lang] ?? LABELS.en;
  const board = report.board;
  const now = Date.parse(report.generatedAt) || Date.now();
  const head = (key) => `## ${ascii ? "" : `${SECTION_ICON[key]} `}${L[key]}`;
  const bucket = (key) => `${BUCKET_ICON[key][ascii ? 1 : 0]} ${L.status[key]}`;
  const step = nowLines(board.now, lang);
  const lines = [head("now"), cutCells(`**${step.action}** — ${step.why}`, 118)];
  lines.push(step.wait ? `${ascii ? "=>" : "👉"} ${L.wait}: ${step.wait}` : `${ascii ? "=>" : "👉"} ${L.type}: ${step.type}`);
  lines.push("", head("glance"));
  const tileHead = ["done", "active", "waiting", "todo"].map((key, index) => `${ascii ? "" : `${BUCKET_ICON[key][0]} `}${L.tiles[index]}`);
  lines.push(`| ${tileHead.join(" | ")} |`, "|:--:|:--:|:--:|:--:|", `| ${board.tiles.done} | ${board.tiles.active} | ${board.tiles.waiting} | ${board.tiles.left} |`, "");
  lines.push(`${L.overall}  ${kpiBar(board.overall.done, board.overall.total, { ascii }) ?? L.noOverall}`, "", head("milestones"));
  if (board.milestones.length === 0) lines.push(L.empty.milestones);
  else {
    const shown = board.milestones.length > BOARD_MILESTONES ? board.milestones.slice(0, BOARD_MILESTONES - 1) : board.milestones;
    lines.push(`| ${L.columns.join(" | ")} |`, "|---|---|---|---|");
    for (const entry of shown) {
      const name = `${md(cutCells(entry.title, 36))}${entry.worktree ? ` (${md(cutCells(entry.worktree, 20))})` : ""}`;
      const ago = entry.changedMs > 0 ? L.ago(Math.max(0, Math.floor((now - entry.changedMs) / 60_000))) : "·";
      lines.push(`| ${name} | ${bucket(entry.bucket)} | ${kpiBar(entry.done, entry.total, { ascii }) ?? "·"} | ${ago} |`);
    }
    if (shown.length < board.milestones.length) lines.push(`| ${L.more(board.milestones.length - shown.length)} | | | |`);
  }
  lines.push("", head("done"));
  if (board.doneLately.length === 0) lines.push(L.empty.done);
  for (const item of board.doneLately) lines.push(cutCells(`- ${md(item)}`, 118));
  lines.push("", head("left"));
  if (board.remaining.length === 0) lines.push(L.empty.left);
  board.remaining.forEach((item, index) => lines.push(cutCells(`${index + 1}. ${md(item)}`, 118)));
  if (board.remainingMore > 0) lines.push(L.more(board.remainingMore));
  lines.push("", head("forget"));
  if (board.reminders.length === 0) lines.push(L.empty.forget);
  for (const entry of board.reminders) lines.push(reminderLine(entry, lang, ascii));
  return lines.join("\n");
}

/** The default brief is the board; the older per-session detail follows it only when asked for. */
export function renderBrief(report, { ascii = false, width = 72, sessionID, lang = "en", detail = false } = {}) {
  const board = renderBoard(report, { ascii, lang });
  if (!detail) return board;
  const L = LABELS[lang] ?? LABELS.en;
  return `${board}\n\n---\n\n## ${ascii ? "" : "🔎 "}${L.detail}\n\n${renderDetail(report, { ascii, width, sessionID })}`;
}

// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index];
    if (arg === "--json") options.format = "json";
    else if (arg === "--brief") options.format = "brief";
    else if (arg === "--ascii") options.ascii = true;
    else if (arg === "--detail") options.detail = true;
    else if (arg === "--lang") options.lang = value();
    else if (arg === "--write-next") options.writeNext = true;
    else if (arg === "--all-dirs") options.allDirs = true;
    else if (arg === "--root") options.root = value();
    else if (arg === "--db") options.db = value();
    else if (arg === "--storage") options.storage = value();
    else if (arg === "--session") options.session = value();
    else if (arg === "--max-sessions") options.maxSessions = Number(value());
    else if (arg === "--now") options.now = Date.parse(value());
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.session !== undefined && !SAFE_SESSION.test(options.session)) throw new Error("--session must match [A-Za-z0-9_-]");
  if (options.now !== undefined && Number.isNaN(options.now)) throw new Error("--now must be an ISO date");
  if (options.lang !== undefined && !BOARD_LANGS.includes(options.lang)) throw new Error(`--lang must be one of ${BOARD_LANGS.join(", ")}`);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await collect(options);
    const view = { ascii: options.ascii === true || process.env.NO_COLOR !== undefined && process.env.TERM === "dumb", sessionID: options.session, lang: options.lang ?? "en", detail: options.detail === true };
    process.stdout.write(`${options.format === "brief" ? renderBrief(report, view) : JSON.stringify({ ...report, boardText: renderBoard(report, view) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`rewind: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

export { STATUS_WORDS };
