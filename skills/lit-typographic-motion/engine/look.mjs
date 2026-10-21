// Look rounds and the done check. Only `render.mjs look` appends to look.json, and it accepts only
// frames from the latest stills set, stamped with the SHA-256 of the current manifest and of each
// frame. The done check reads look.json, the gate report, the treatment and (under OpenCode) the
// record of image reads the plugin's tool hook keeps, so "the command ran" never counts as done.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downgrades, loadTreatment } from "./treatment.mjs";
import { stageSha } from "./stage/scan.mjs";
import { COVER } from "./constants.mjs";
import { generatedAssetLabels } from "./cover/assets.mjs";
import { isCoverRun, validateCoverTreatment } from "./cover/treatment.mjs";

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
// A cover is looked at for motion, the seam and damage, never for beats (references/cover.md).
export const COVER_LOOK_QUESTIONS = Object.freeze([
  "Is something moving in every half-second window (the sheet's plot never lies flat on the red dashes)?",
  "Does the seam disappear in the decoded file (seam.png, the right end of the plot)?",
  "Does it still move after encoding, with no region that freezes and then pops?",
  "Is the brand word present, legible and in place in every frame, never faded or swapped?",
  "Are all three speed layers visible: a slow perpetual layer, a mid swell, beat events?",
  "Does anything read as a slide, a card swap, a title fade or an end card, or does light wash in place instead of travelling as an edge?",
  "Is any glyph, glint or glow damaged: a colour block, a dark disc, a visible box?",
  "Would a skilled motion designer add or remove something? Name it."
]);
const coverNoMeansRevise = new Set([1, 2, 3, 4, 5]);
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

export function needsAnotherRound(answers, kind = "film") {
  const reviseOnNo = kind === "cover" ? coverNoMeansRevise : noMeansRevise;
  return answers.filter((answer) => (reviseOnNo.has(answer.q) ? answer.verdict === "no" : answer.verdict === "yes")).map((answer) => answer.q);
}

// Cover defects, at most three per round, worst first: { t, region, frame, observed, cause, fix }.
// `t` is the loop time in seconds where it shows, `region` the [x, y, w, h] it covers in cover pixels,
// `frame` a file of the current stills set that shows it. A window render around t checks the fix.
function checkDefects(list, set) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new LookError("defects must be an array");
  if (list.length > COVER.maxDefects) throw new LookError(`at most ${COVER.maxDefects} defects per round; record the worst first`);
  const [width, height] = set.stills.size;
  const loopSec = set.stills.durationSec;
  return list.map((defect, i) => {
    const at = `defect ${i + 1}`;
    if (!defect || typeof defect !== "object") throw new LookError(`${at} must be an object`);
    if (typeof defect.t !== "number" || !(defect.t >= 0) || defect.t >= loopSec) throw new LookError(`${at}: t must be the loop time in seconds (0 to ${loopSec}) where the defect shows`);
    const r = defect.region;
    if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger) || r[0] < 0 || r[1] < 0 || r[2] <= 0 || r[3] <= 0 || r[0] + r[2] > width || r[1] + r[3] > height) throw new LookError(`${at}: region must be [x, y, w, h] inside the ${width}x${height} cover`);
    if (!set.files.includes(defect.frame)) throw new LookError(`${at}: frame ${defect.frame} is not in the latest stills set`);
    if (!concreteObservation(defect.observed)) throw new LookError(`${at}: observed must be a sentence naming what is visible there`);
    for (const key of ["cause", "fix"]) if (typeof defect[key] !== "string" || defect[key].trim().length < 8 || /<[^<>\n]{1,80}>/u.test(defect[key])) throw new LookError(`${at}: ${key} must say something concrete`);
    return { t: defect.t, region: r, frame: defect.frame, observed: defect.observed.trim(), cause: defect.cause.trim(), fix: defect.fix.trim() };
  });
}

// The frames a round may cite: the latest stills set, plus the poster after a full render.
export function currentSet(out) {
  const stills = readJson(path.join(out, "stills", "stills.json"));
  if (!stills) throw new LookError("no stills set in this output directory; render one first");
  const stillsSha = shaFile(path.join(out, "stills", "stills.json"));
  const manifestFile = path.join(out, "manifest.json");
  const manifest = readJson(manifestFile);
  const files = stills.files.map((entry) => entry.file);
  if (stills.mode === "cover") {
    const rendered = manifest?.mode === "cover" && manifest.stillsSha256 === stillsSha;
    return { stills, kind: "cover", manifestSha: rendered ? shaFile(manifestFile) : stillsSha, files };
  }
  const film = manifest && manifest.stillsSha256 === stillsSha && manifest.craftRound === stills.round;
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
  const cover = set.kind === "cover";
  const questions = cover ? COVER_LOOK_QUESTIONS : LOOK_QUESTIONS;
  const blocked = input.blocked === "no-vision-tool";
  const viewed = [...new Set([...(Array.isArray(input.viewed) ? input.viewed : []), ...(Array.isArray(input.answers) ? input.answers.map((answer) => answer?.frame).filter((frame) => frame && frame !== "sound-cues.json") : [])])];
  const unknown = viewed.filter((frame) => typeof frame !== "string" || !set.files.includes(frame.replace(/^\.\//u, "")));
  if (unknown.length) throw new LookError(`not in the latest stills set: ${unknown.join(", ")}`);
  const answers = Array.isArray(input.answers) ? input.answers : [];
  if (!blocked) {
    const asked = new Set(answers.map((answer) => answer?.q));
    const missing = questions.map((_, i) => i + 1).filter((q) => !asked.has(q));
    if (missing.length) throw new LookError(`answer every question; missing ${missing.join(", ")}`);
    for (const answer of answers) {
      if (!Number.isInteger(answer.q) || answer.q < 1 || answer.q > questions.length) throw new LookError(`unknown question ${answer.q}`);
      if (!["yes", "no"].includes(answer.verdict)) throw new LookError(`question ${answer.q}: verdict must be "yes" or "no"`);
      if (!concreteObservation(answer.observed)) throw new LookError(`question ${answer.q}: "observed" must be a sentence naming something visible in ${answer.frame ?? "the frame"}, not a bare answer`);
      if (answer.q === 6 && !cover ? !["sound-cues.json", ...set.files].includes(answer.frame) : !set.files.includes(answer.frame)) throw new LookError(`question ${answer.q}: frame ${answer.frame} is not in the latest stills set`);
      if (answer.q === 1 && !cover && !["blind", "self"].includes(answer.by)) throw new LookError('question 1: "by" must be "blind" (a fresh subagent) or "self"');
    }
  }
  if (cover) {
    if (round === 1 && !blocked && (typeof input.change !== "string" || !input.change.trim())) throw new LookError("round 1 of a cover must name the change you will make before round 2");
  } else {
    if (input.defects !== undefined) throw new LookError("defects belong to a cover round; a film round names its weakest beat");
    if (round === 1 && set.kind !== "stills") throw new LookError("round 1 is a stills round, before the first full render");
    if (round === 1 && !blocked && (typeof input.change !== "string" || !input.change.trim() || typeof input.weakestBeat !== "string" || !input.weakestBeat.trim())) throw new LookError("round 1 must name the weakest beat and the change you will make");
  }
  const defects = cover ? checkDefects(input.defects, set) : [];
  const frames = Object.fromEntries(viewed.map((frame) => [frame, shaFile(path.join(out, frame))]));
  const entry = {
    round, kind: set.kind, manifestSha256: set.manifestSha, frames, answers: answers.map(({ q, verdict, frame, observed, by }) => ({ q, verdict, frame, observed, ...(by ? { by } : {}) })),
    ...(input.weakestBeat ? { weakestBeat: String(input.weakestBeat) } : {}), ...(input.change ? { change: String(input.change) } : {}),
    ...(Array.isArray(input.aids) ? { aids: input.aids.map(String) } : {}), ...(blocked ? { blocked: "no-vision-tool" } : {}),
    ...(cover ? { defects } : {}),
    needsAnotherRound: blocked ? [] : needsAnotherRound(answers, set.kind), host: process.env.OPENCODE === "1" ? "opencode" : null, recordedAt: new Date().toISOString()
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

// The cover branch of the done check (references/cover.md, "Rounds and done"): a valid cover
// treatment; the last render's report at PASS+TARGET on the decoded file, with nothing changed since;
// two look rounds, the first naming its change, the last on the final render's stills and opening
// the sheet, the poster and the seam pair with the read tool. Generated assets owe a reply label.
export function coverDoneState(out) {
  const reasons = [], open = [];
  const labels = generatedAssetLabels(out);
  const result = (status, code) => ({ status, code, done: code === 0, reasons, open, downgraded: [], labels, mode: "cover" });
  let raw = null;
  try { raw = JSON.parse(readFileSync(path.join(out, "treatment.json"), "utf8")); } catch (error) { reasons.push(`treatment.json is unreadable (${error.message})`); return result("NOT DONE", 1); }
  const valid = validateCoverTreatment(raw);
  if (!valid.ok) { reasons.push(`BLOCKED_TREATMENT_INVALID (16): field ${valid.field}: ${valid.detail}`); return result("NOT DONE", 1); }
  const manifestFile = path.join(out, "manifest.json");
  const manifest = readJson(manifestFile);
  const report = existsSync(path.join(out, "gate-report.txt")) ? readFileSync(path.join(out, "gate-report.txt"), "utf8") : null;
  if (manifest?.mode !== "cover" || !report) { reasons.push("no finished cover render (manifest.json or gate-report.txt is missing): run render.mjs cover"); return result("NOT DONE", 1); }
  if (manifest.treatmentSha256 !== shaFile(path.join(out, "treatment.json"))) reasons.push("the treatment changed after the last cover render; render again");
  if (existsSync(path.join(out, "cover")) && manifest.coverSha256 !== stageSha(path.join(out, "cover"))) reasons.push("the cover page or an asset changed after the last cover render; render again");
  const passed = /^COVER gate --strict: PASS\+TARGET$/mu.test(report);
  const rounds = readJson(path.join(out, "look.json"), { rounds: [] }).rounds;
  const first = rounds[0], last = rounds.at(-1);
  const round = manifest.craftRound ?? last?.round ?? 0;
  if (!passed) (round >= 3 ? open : reasons).push(`the decoded cover did not reach every TARGET gate (${report.split("\n").filter((line) => /^\s+\S+ (?:FAIL|pass\(floor\))(?: |$)/u.test(line)).map((line) => line.trim().split(" ")[0]).join(", ") || "see gate-report.txt"})`);
  if (existsSync(path.join(out, "withheld"))) reasons.push("the flash audit failed; the cover is withheld");
  if (rounds.length < 2) reasons.push(`${rounds.length} look round(s) recorded; a cover needs two: look, make the named change, render again, look again`);
  if (first && !first.blocked && !first.change) reasons.push("round 1 must name the change made before round 2");
  let unviewed = false;
  if (last) {
    if (last.kind !== "cover" || last.manifestSha256 !== shaFile(manifestFile)) reasons.push("the last look round was not taken on the final cover render; look again at this render");
    let set = null;
    try { set = currentSet(out); } catch (error) { reasons.push(error.message); }
    if (set && !last.blocked) {
      const required = set.stills.files.filter((entry) => ["sheet", "poster", "seam"].includes(entry.kind)).map((entry) => entry.file);
      const skipped = required.filter((file) => !Object.hasOwn(last.frames ?? {}, file));
      if (skipped.length) reasons.push(`the last round did not view: ${skipped.join(", ")}`);
    }
    if (last.blocked === "no-vision-tool") unviewed = true;
    if (last.host === "opencode" && !last.blocked) {
      const reads = imageReads(out);
      const notRead = Object.entries(last.frames ?? {}).filter(([file, sha]) => !reads.some((read) => read.file === file && read.sha256 === sha)).map(([file]) => file);
      if (notRead.length) reasons.push(`not opened with the read tool: ${notRead.join(", ")}`);
    }
    if (last.needsAnotherRound?.length) (last.round >= 3 ? open : reasons).push(`cover look questions ${last.needsAnotherRound.join(", ")} ask for another round`);
  }
  if (reasons.length) return result("NOT DONE", 1);
  if (unviewed) return result("DONE_UNVIEWED", 3);
  if (open.length) return result("DONE_WITH_OPEN_ITEMS", 2);
  return result("DONE", 0);
}

// Status: DONE (0), NOT DONE (1), DONE_WITH_OPEN_ITEMS (2, round 3 spent), DONE_UNVIEWED (3).
export function doneState(dir) {
  const out = path.resolve(dir);
  if (isCoverRun(out)) return coverDoneState(out);
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
  if (state.done || state.code === 2 || state.code === 3) for (const label of state.labels ?? []) lines.push(label);
  if (state.status === "DONE_UNVIEWED") lines.push("nobody viewed the frames: say so plainly in the reply");
  return lines.join("\n");
}
