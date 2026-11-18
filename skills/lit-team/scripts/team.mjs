#!/usr/bin/env node
// The lit-team packet: one folder per team under `.litopencode/team/<slug>/` with the goal, the chosen
// distribution, one brief and one private scratch folder per member, the members' reports and, at the end,
// an archive receipt. The orchestrating session runs it; members only write their own report.
// Usage:
//   node team.mjs pick --slices <n> [--same-files] [--similar] [--watch]
//   node team.mjs init <slug> --goal <text> --distribution <subagents|batches|worktrees|herdr>
//   node team.mjs member <slug> <name> --task <t> --deliverable <d> --scope <s> --verify <v> [--agent <id>]
//   node team.mjs status <slug> [--stall-min <minutes>] [--json]
//   node team.mjs archive <slug>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PACKET_SCHEMA = "litopencode.team-packet/v1";
export const DISTRIBUTIONS = Object.freeze(["subagents", "batches", "worktrees", "herdr"]);
export const MAX_SUBAGENT_SLICES = 6;
export const DEFAULT_STALL_MIN = 15;
const safeName = /^[a-z0-9][a-z0-9-]{0,47}$/u;

/** herdr panes only when this session runs inside herdr and the herdr command exists. */
export function herdrAvailable(env = process.env, which = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0) {
  return env.HERDR_ENV === "1" && which("herdr");
}

/**
 * The distribution and the one line that says why. Same files beat everything (worktrees keep the slices
 * apart); watched or long-running work goes to herdr panes only when herdr is there; many similar items go
 * to batches of task calls; otherwise one subagent per slice.
 */
export function pickDistribution({ slices, sameFiles = false, similar = false, watch = false, herdr = false }) {
  if (!Number.isInteger(slices) || slices < 1) throw new Error("slices must be a positive whole number");
  if (sameFiles) return { distribution: "worktrees", line: `Team: ${slices} slices edit the same files, so each gets its own git worktree and subagent; I merge them.` };
  if (watch && herdr) return { distribution: "herdr", line: `Team: ${slices} members in herdr panes you can watch; I brief, check and merge them.` };
  const fallback = watch ? " (herdr is not available here, so subagents instead)" : "";
  if (similar || slices > MAX_SUBAGENT_SLICES) return { distribution: "batches", line: `Team: ${slices} similar items in batches of parallel task calls${fallback}; I check and merge them.` };
  return { distribution: "subagents", line: `Team: ${slices} subagents through the task tool, one brief each${fallback}; I check and merge them.` };
}

function teamDir(root, slug) {
  if (!safeName.test(slug)) throw new Error("slug must be lowercase letters, digits and dashes");
  return path.join(root, ".litopencode", "team", slug);
}

function readPacket(dir) {
  const packet = JSON.parse(fs.readFileSync(path.join(dir, "packet.json"), "utf8"));
  if (packet.schema !== PACKET_SCHEMA) throw new Error("not a LitOpenCode team packet");
  return packet;
}

function writePacket(dir, packet) {
  const file = path.join(dir, "packet.json");
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(packet, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

export function initTeam(root, slug, { goal, distribution, now = Date.now() }) {
  if (typeof goal !== "string" || goal.trim() === "") throw new Error("--goal is required");
  if (!DISTRIBUTIONS.includes(distribution)) throw new Error(`--distribution must be one of ${DISTRIBUTIONS.join(", ")}`);
  const dir = teamDir(root, slug);
  if (fs.existsSync(path.join(dir, "packet.json"))) throw new Error(`team ${slug} already exists; pick another slug or archive it`);
  fs.mkdirSync(path.join(dir, "members"), { recursive: true });
  const packet = { schema: PACKET_SCHEMA, slug, goal: goal.trim(), distribution, createdAt: new Date(now).toISOString(), members: [] };
  writePacket(dir, packet);
  return packet;
}

/** One brief per member, with its own scratch folder; the brief carries the rules every member keeps. */
export function addMember(root, slug, name, { task, deliverable, scope, verify, agent = "lit-forge-worker" }) {
  if (!safeName.test(name)) throw new Error("member name must be lowercase letters, digits and dashes");
  for (const [key, value] of Object.entries({ task, deliverable, scope, verify })) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`--${key} is required`);
  }
  const dir = teamDir(root, slug);
  const packet = readPacket(dir);
  if (packet.members.some((member) => member.name === name)) throw new Error(`member ${name} already exists`);
  const memberDir = path.join(dir, "members", name);
  const scratch = path.join(memberDir, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const report = path.join(memberDir, "report.md");
  const brief = [
    `TASK: ${task.trim()}`,
    `DELIVERABLE: ${deliverable.trim()}`,
    `SCOPE: ${scope.trim()}`,
    `VERIFY: ${verify.trim()}`,
    "",
    "Rules:",
    "- Never commit, push, tag, publish or bump a version; the orchestrator merges.",
    `- Temporary files go only in ${path.relative(root, scratch)}.`,
    "- Never print environment variables.",
    `- When done, write ${path.relative(root, report)}: what you changed, how you verified it, what is left or risky. No search log, no diary.`,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(memberDir, "brief.md"), brief);
  packet.members.push({ name, agent, scope: scope.trim(), brief: path.relative(root, path.join(memberDir, "brief.md")), scratch: path.relative(root, scratch), report: path.relative(root, report) });
  writePacket(dir, packet);
  return { brief, packet };
}

function newestMtime(target) {
  let newest = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink()) continue;
    newest = Math.max(newest, stat.mtimeMs);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
  }
  return newest;
}

/** done: a report exists; working: the scratch moved within the stall window; stalled: it did not. */
export function teamStatus(root, slug, { stallMin = DEFAULT_STALL_MIN, now = Date.now() } = {}) {
  const dir = teamDir(root, slug);
  const packet = readPacket(dir);
  const members = packet.members.map((member) => {
    const report = path.join(root, member.report);
    if (fs.existsSync(report)) return { name: member.name, state: "done" };
    const last = Math.max(newestMtime(path.join(root, member.scratch)), newestMtime(path.join(root, member.brief)));
    const idleMin = Math.floor((now - last) / 60_000);
    return { name: member.name, state: idleMin >= stallMin ? "stalled" : "working", idleMin };
  });
  return { slug, distribution: packet.distribution, members, done: members.every((member) => member.state === "done") };
}

export function archiveTeam(root, slug, { now = Date.now() } = {}) {
  const dir = teamDir(root, slug);
  const status = teamStatus(root, slug, { now });
  const receipt = { schema: "litopencode.team-receipt/v1", slug, archivedAt: new Date(now).toISOString(), members: status.members };
  fs.writeFileSync(path.join(dir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  const archive = path.join(root, ".litopencode", "team", "archive");
  fs.mkdirSync(archive, { recursive: true });
  const target = path.join(archive, `${slug}-${new Date(now).toISOString().replace(/[:.]/gu, "-")}`);
  fs.renameSync(dir, target);
  return { receipt, path: path.relative(root, target) };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  try {
    if (command === "pick") {
      const picked = pickDistribution({ slices: Number(option(args, "--slices")), sameFiles: args.includes("--same-files"), similar: args.includes("--similar"), watch: args.includes("--watch"), herdr: herdrAvailable() });
      process.stdout.write(`${args.includes("--json") ? JSON.stringify(picked) : picked.line}\n`);
    } else if (command === "init") {
      const packet = initTeam(root, args[0], { goal: option(args, "--goal"), distribution: option(args, "--distribution") });
      process.stdout.write(`team ${packet.slug} ready (${packet.distribution}) in .litopencode/team/${packet.slug}/\n`);
    } else if (command === "member") {
      const { brief } = addMember(root, args[0], args[1], { task: option(args, "--task"), deliverable: option(args, "--deliverable"), scope: option(args, "--scope"), verify: option(args, "--verify"), ...(option(args, "--agent") === undefined ? {} : { agent: option(args, "--agent") }) });
      process.stdout.write(brief);
    } else if (command === "status") {
      const status = teamStatus(root, args[0], { stallMin: Number(option(args, "--stall-min") ?? DEFAULT_STALL_MIN) });
      process.stdout.write(args.includes("--json") ? `${JSON.stringify(status)}\n` : `${status.members.map((m) => `${m.name}: ${m.state}${m.idleMin === undefined ? "" : ` (${m.idleMin} min since last change)`}`).join("\n")}\n`);
    } else if (command === "archive") {
      const done = archiveTeam(root, args[0]);
      process.stdout.write(`archived to ${done.path}\n`);
    } else {
      throw new Error("usage: team.mjs pick|init|member|status|archive");
    }
  } catch (error) {
    process.stderr.write(`team: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
