// Look rounds and the done check. Only `render.mjs look` appends to look.json, and it accepts only
// frames from the latest stills set, stamped with the SHA-256 of the current manifest and of each
// frame. The done check reads look.json, the gate report, the treatment and (under OpenCode) the
// record of image reads the plugin's tool hook keeps, so "the command ran" never counts as done.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downgrades, loadTreatment } from "./treatment.mjs";
import { stageSha } from "./stage/scan.mjs";

export const LOOK_QUESTIONS = Object.freeze([
  "A stranger would say this film is for: <…>",
  "Does every beat show its onScreen plan?",
  "Is the craft at the level ambition asks for (transitions, rhythm, depth, hierarchy)?",
  "Is any request text, meta label, placeholder, file name or internal term on screen?",
  "Does the ending land?",
  "Does the sound follow the cuts?",
  "Name one thing a skilled motion designer, given only the request, would have shown that this film does not.",
  "Is any element on screen without a job in its beat?",
  "Could every copy line be pasted unchanged into a film about a different subject?"
]);
// A "no" here means another round; for the others a "yes" does (Q7: a nameable gap).
const noMeansRevise = new Set([1, 2, 3, 5, 6]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaFile = (file) => sha256(readFileSync(file));
const readJson = (file, fallback = null) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

class LookError extends Error { constructor(message) { super(`look refused: ${message}`); this.exitCode = 2; } }

// One concrete sentence: not a bare yes/no, and enough words to name something visible.
export function concreteObservation(text) {
  if (typeof text !== "string") return false;
  const value = text.trim();
  if (/^(?:yes|no|y|n|ok|none|n\/a|예|아니요|아니오|네|없음)[.!]?$/iu.test(value)) return false;
  const words = value.split(/\s+/u).filter(Boolean).length;
  return words >= 4 || (words >= 2 && value.replace(/\s+/gu, "").length >= 12);
}

export function needsAnotherRound(answers) {
  return answers.filter((answer) => (noMeansRevise.has(answer.q) ? answer.verdict === "no" : answer.verdict === "yes")).map((answer) => answer.q);
}

// The frames a round may cite: the latest stills set, plus the poster after a full render.
export function currentSet(out) {
  const stills = readJson(path.join(out, "stills", "stills.json"));
  if (!stills) throw new LookError("no stills set in this output directory; render one first");
  const stillsSha = shaFile(path.join(out, "stills", "stills.json"));
  const manifestFile = path.join(out, "manifest.json");
  const manifest = readJson(manifestFile);
  const film = manifest && manifest.stillsSha256 === stillsSha && manifest.craftRound === stills.round;
  const files = stills.files.map((entry) => entry.file);
  const poster = ["poster.png", path.join("withheld", "poster.png")].find((name) => existsSync(path.join(out, name)));
  if (film && poster) files.push(poster);
  return { stills, kind: film ? "film" : "stills", manifestSha: film ? shaFile(manifestFile) : stillsSha, files };
}

export function recordLook(out, round, answersFile) {
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new LookError("--round must be 1, 2 or 3");
  if (!answersFile || !existsSync(answersFile)) throw new LookError("--answers <file> must name a JSON file");
  let input;
  try { input = JSON.parse(readFileSync(answersFile, "utf8")); } catch (error) { throw new LookError(`the answers file is not JSON (${error.message})`); }
  const look = readJson(path.join(out, "look.json"), { schemaVersion: 1, rounds: [] });
  const expected = (look.rounds.at(-1)?.round ?? 0) + 1;
  if (round !== expected) throw new LookError(`the next round is ${expected}; rounds share one counter with renders`);
  const set = currentSet(out);
  if (set.stills.round !== round) throw new LookError(`the latest stills set was rendered with --round ${set.stills.round}; look at the set of round ${round}`);
  const blocked = input.blocked === "no-vision-tool";
  const viewed = [...new Set([...(Array.isArray(input.viewed) ? input.viewed : []), ...(Array.isArray(input.answers) ? input.answers.map((answer) => answer?.frame).filter((frame) => frame && frame !== "sound-cues.json") : [])])];
  const unknown = viewed.filter((frame) => typeof frame !== "string" || !set.files.includes(frame.replace(/^\.\//u, "")));
  if (unknown.length) throw new LookError(`not in the latest stills set: ${unknown.join(", ")}`);
  const answers = Array.isArray(input.answers) ? input.answers : [];
  if (!blocked) {
    const asked = new Set(answers.map((answer) => answer?.q));
    const missing = LOOK_QUESTIONS.map((_, i) => i + 1).filter((q) => !asked.has(q));
    if (missing.length) throw new LookError(`answer every question; missing ${missing.join(", ")}`);
    for (const answer of answers) {
      if (!Number.isInteger(answer.q) || answer.q < 1 || answer.q > 9) throw new LookError(`unknown question ${answer.q}`);
      if (!["yes", "no"].includes(answer.verdict)) throw new LookError(`question ${answer.q}: verdict must be "yes" or "no"`);
      if (!concreteObservation(answer.observed)) throw new LookError(`question ${answer.q}: "observed" must be a sentence naming something visible in ${answer.frame ?? "the frame"}, not a bare answer`);
      if (answer.q === 6 ? !["sound-cues.json", ...set.files].includes(answer.frame) : !set.files.includes(answer.frame)) throw new LookError(`question ${answer.q}: frame ${answer.frame} is not in the latest stills set`);
      if (answer.q === 1 && !["blind", "self"].includes(answer.by)) throw new LookError('question 1: "by" must be "blind" (a fresh subagent) or "self"');
    }
  }
  if (round === 1 && set.kind !== "stills") throw new LookError("round 1 is a stills round, before the first full render");
  if (round === 1 && !blocked && (typeof input.change !== "string" || !input.change.trim() || typeof input.weakestBeat !== "string" || !input.weakestBeat.trim())) throw new LookError("round 1 must name the weakest beat and the change you will make");
  const frames = Object.fromEntries(viewed.map((frame) => [frame, shaFile(path.join(out, frame))]));
  const entry = {
    round, kind: set.kind, manifestSha256: set.manifestSha, frames, answers: answers.map(({ q, verdict, frame, observed, by }) => ({ q, verdict, frame, observed, ...(by ? { by } : {}) })),
    ...(input.weakestBeat ? { weakestBeat: String(input.weakestBeat) } : {}), ...(input.change ? { change: String(input.change) } : {}),
    ...(Array.isArray(input.aids) ? { aids: input.aids.map(String) } : {}), ...(blocked ? { blocked: "no-vision-tool" } : {}),
    needsAnotherRound: blocked ? [] : needsAnotherRound(answers), host: process.env.OPENCODE === "1" ? "opencode" : null, recordedAt: new Date().toISOString()
  };
  look.rounds.push(entry);
  writeFileSync(path.join(out, "look.json"), JSON.stringify(look, null, 2) + "\n");
  return entry;
}

// Every image the last round must have viewed: poster, contact sheet, every beat midpoint and strip.
export function requiredFrames(set) {
  return set.files.filter((file) => /(?:^|\/)poster\.png$|sheet\/contact\.png$|stills\/beat-\d+-mid\.png$|stills\/cut-\d+-strip\.png$/u.test(file));
}

function imageReads(out) {
  const file = path.join(out, ".run", "image-reads.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

// Status: DONE (0), NOT DONE (1), DONE_WITH_OPEN_ITEMS (2, round 3 spent), DONE_UNVIEWED (3).
export function doneState(dir) {
  const out = path.resolve(dir);
  const reasons = [], open = [];
  const result = (status, code) => ({ status, code, done: code === 0, reasons, open, downgraded });
  let treatment = null, downgraded = [];
  try { ({ treatment } = loadTreatment(out)); } catch (error) { reasons.push(error.message); return result("NOT DONE", 1); }
  downgraded = downgrades(readJson(path.join(out, ".run", "treatment-first.json")), treatment);
  const manifestFile = path.join(out, "manifest.json");
  const manifest = readJson(manifestFile);
  if (!manifest) { reasons.push("no finished render (no manifest.json): a stills round or a BLOCKED exit is not a film"); return result("NOT DONE", 1); }
  const report = existsSync(path.join(out, "gate-report.txt")) ? readFileSync(path.join(out, "gate-report.txt"), "utf8") : null;
  if (!report) { reasons.push("the gate never ran on this render"); return result("NOT DONE", 1); }
  if (manifest.treatmentSha256 && manifest.treatmentSha256 !== shaFile(path.join(out, "treatment.json"))) reasons.push("the treatment changed after the last render; render again");
  const briefRecord = readJson(path.join(out, ".run", "brief.json"));
  if (manifest.path === "type" && briefRecord?.path && existsSync(briefRecord.path) && shaFile(briefRecord.path) !== briefRecord.sha256) reasons.push("the brief changed after the last render; render again");
  if (manifest.path === "stage" && manifest.stageSha256 && existsSync(path.join(out, "stage")) && manifest.stageSha256 !== stageSha(path.join(out, "stage"))) reasons.push("the stage page changed after the last render; render again");
  const exit = Number(report.match(/^gate exit: (\d+)$/mu)?.[1]);
  const withheld = /^export state: withheld/mu.test(report);
  const failed = [...report.matchAll(/^\s+(\S+) (?:[a-z-]+:\s+)?.*\bFAIL\b/gmu)].map((m) => m[1]);
  const look = readJson(path.join(out, "look.json"), { rounds: [] });
  const rounds = look.rounds;
  const first = rounds[0], last = rounds.at(-1);
  if (rounds.length < 2) reasons.push(`${rounds.length} look round(s) recorded; done needs the stills round 1 and a round on the final render`);
  if (first && (first.round !== 1 || first.kind !== "stills" || (!first.blocked && !first.change))) reasons.push("round 1 must be a stills round that names a change");
  let unviewed = false;
  if (last) {
    if (last.kind !== "film" || last.manifestSha256 !== shaFile(manifestFile)) reasons.push("the last look round was not taken on the final render's own stills; look again at this render");
    let set = null;
    try { set = currentSet(out); } catch (error) { reasons.push(error.message); }
    if (set) {
      const missingFrames = requiredFrames(set).filter((file) => !Object.hasOwn(last.frames ?? {}, file));
      if (missingFrames.length && !last.blocked) reasons.push(`the last round did not view: ${missingFrames.join(", ")}`);
    }
    if (last.blocked === "no-vision-tool" || first?.blocked === "no-vision-tool") unviewed = true;
    if (last.host === "opencode" && !last.blocked) {
      const reads = imageReads(out);
      const notRead = Object.entries(last.frames ?? {}).filter(([file, sha]) => !reads.some((read) => read.file === file && read.sha256 === sha)).map(([file]) => file);
      if (notRead.length) reasons.push(`not opened with the read tool: ${notRead.join(", ")}`);
    }
    if (last.needsAnotherRound?.length) (last.round >= 3 ? open : reasons).push(`look questions ${last.needsAnotherRound.join(", ")} ask for another round`);
  }
  const round = manifest.craftRound ?? last?.round ?? 0;
  if (exit !== 0) (round >= 3 ? open : reasons).push(withheld ? `the flash audit failed; the film is withheld (${failed.join(", ")})` : `gate FAIL: ${failed.join(", ") || `exit ${exit}`}`);
  if (reasons.length) return result("NOT DONE", 1);
  if (unviewed) return result("DONE_UNVIEWED", 3);
  if (open.length) return result("DONE_WITH_OPEN_ITEMS", 2);
  return result("DONE", 0);
}

export function formatDone(state) {
  const lines = [`${state.status}${state.reasons.length ? `: ${state.reasons[0]}` : ""}`];
  for (const reason of state.reasons.slice(1)) lines.push(`- ${reason}`);
  for (const item of state.open) lines.push(`open: ${item}`);
  for (const item of state.downgraded) lines.push(`downgraded: ${item}`);
  if (state.status === "DONE_UNVIEWED") lines.push("nobody viewed the frames: say so plainly in the reply");
  return lines.join("\n");
}
