import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { concreteObservation, doneState, needsAnotherRound, recordLook } from "../skills/lit-typographic-motion/engine/look.mjs";
import { encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { createToolExecuteAfterHook } from "../src/hooks.ts";
import { recordMotionImageRead } from "../src/motion-image-reads.ts";
import { fixtureStageTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";
import { tempDir, writeRun } from "../test-support/motion-fixture.mjs";
import { runGate } from "../skills/lit-typographic-motion/gate.mjs";

// Look rounds and the done check, on synthetic output directories (no browser needed).
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const gate = path.join(skillRoot, "gate.mjs");
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const png = (shade) => encodePng(4, 4, Buffer.alloc(64, shade), 4, 1);

// A stills set for `round`; with `film`, also the manifest, poster and a gate report that exits `exit`.
function renderRound(out, round, { film = false, exit = 0, withheld = false } = {}) {
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  fs.mkdirSync(path.join(out, "sheet"), { recursive: true });
  fs.mkdirSync(path.join(out, ".run"), { recursive: true });
  const files = [];
  for (const [rel, kind] of [["stills/beat-01-mid.png", "beat"], ["stills/beat-02-mid.png", "beat"], ["stills/beat-03-mid.png", "beat"], ["stills/cut-01-strip.png", "strip"], ["stills/cut-02-strip.png", "strip"], ["sheet/contact.png", "sheet"]]) {
    fs.writeFileSync(path.join(out, rel), png(round * 40 + files.length));
    files.push({ file: rel, kind, sha256: sha(path.join(out, rel)) });
  }
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ schemaVersion: 1, path: "stage", round, fps: 30, size: [1920, 1080], files }));
  if (!film) return;
  fs.writeFileSync(path.join(out, "poster.png"), png(200 + round));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, path: "stage", craftRound: round, treatmentSha256: sha(path.join(out, "treatment.json")), stillsSha256: sha(path.join(out, "stills", "stills.json")), frameCount: 126, fps: 30 }));
  fs.writeFileSync(path.join(out, "gate-report.txt"), [`QA gate: ${exit ? "FAIL" : "PASS"}`, exit ? "  TEXT-contrast FAIL  (\"x\" at frame 3: 1.2:1 < 4.5:1)" : "  TEXT-contrast PASS  (fine)", `gate exit: ${exit}`, `export state: ${withheld ? "withheld (MO-C-03 FAIL: diagnostics only, never deliverables)" : "delivered"}`, ""].join("\n"));
}

function answersFor(frames, { verdicts = {}, observed } = {}) {
  const good = { 1: "yes", 2: "yes", 3: "yes", 4: "no", 5: "yes", 6: "yes", 7: "no", 8: "no", 9: "no" };
  return Array.from({ length: 9 }, (_, i) => ({ q: i + 1, verdict: verdicts[i + 1] ?? good[i + 1], frame: i === 5 ? "sound-cues.json" : frames[i % frames.length], observed: observed ?? "The drawn basin fills with teal water under the low copy line.", ...(i === 0 ? { by: "blind" } : {}) }));
}

function writeAnswers(dir, body) {
  const file = path.join(dir, `answers-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

const allFrames = ["stills/beat-01-mid.png", "stills/beat-02-mid.png", "stills/beat-03-mid.png", "stills/cut-01-strip.png", "stills/cut-02-strip.png", "sheet/contact.png"];

function doneRun({ host = null, secondRound = true, exit = 0, lastFrames = [...allFrames, "poster.png"] } = {}) {
  const dir = tmp("ltm-look-");
  const out = path.join(dir, "out");
  writeTreatment(out, fixtureStageTreatment());
  fs.mkdirSync(path.join(out, ".run"), { recursive: true });
  fs.writeFileSync(path.join(out, ".run", "treatment-first.json"), fs.readFileSync(path.join(out, "treatment.json")));
  renderRound(out, 1);
  const previous = process.env.OPENCODE;
  if (host) process.env.OPENCODE = "1"; else delete process.env.OPENCODE;
  try {
    recordLook(out, 1, writeAnswers(dir, { viewed: allFrames, weakestBeat: "beat 2: the drop reads as a dot", change: "draw the drop with a tail and a splash ring", answers: answersFor(allFrames) }));
    renderRound(out, 2, { film: true, exit });
    if (secondRound) recordLook(out, 2, writeAnswers(dir, { viewed: lastFrames, answers: answersFor(lastFrames) }));
  } finally {
    if (previous === undefined) delete process.env.OPENCODE; else process.env.OPENCODE = previous;
  }
  return { dir, out };
}

test("observations must name something visible; a bare yes or no is refused", () => {
  assert.equal(concreteObservation("yes"), false);
  assert.equal(concreteObservation("아니요"), false);
  assert.equal(concreteObservation("The teal basin fills to the gravel lip."), true);
  assert.equal(concreteObservation("물이 자갈 턱까지 차오른다"), true);
  assert.deepEqual(needsAnotherRound(answersFor(allFrames, { verdicts: { 2: "no", 7: "yes", 9: "yes" } })), [2, 7, 9]);
});

test("look refuses frames outside the latest stills set, bare answers, a skipped counter and a round 1 without a change", () => {
  const dir = tmp("ltm-look-refuse-");
  const out = path.join(dir, "out");
  try {
    writeTreatment(out, fixtureStageTreatment());
    renderRound(out, 1);
    const run = (body, round = 1) => spawnSync(process.execPath, [render, "look", "--out", out, "--round", String(round), "--answers", writeAnswers(dir, body)], { encoding: "utf8" });
    let result = run({ viewed: ["stills/beat-09-mid.png"], weakestBeat: "b", change: "c", answers: answersFor(allFrames) });
    assert.equal(result.status, 2); assert.match(result.stderr, /not in the latest stills set: stills\/beat-09-mid\.png/u);
    result = run({ viewed: allFrames, weakestBeat: "b", change: "c", answers: answersFor(allFrames, { observed: "yes" }) });
    assert.equal(result.status, 2); assert.match(result.stderr, /"observed" must be a sentence naming something visible/u);
    result = run({ viewed: allFrames, answers: answersFor(allFrames) });
    assert.equal(result.status, 2); assert.match(result.stderr, /round 1 must name the weakest beat and the change/u);
    result = run({ viewed: allFrames, weakestBeat: "b", change: "c", answers: answersFor(allFrames) }, 2);
    assert.equal(result.status, 2); assert.match(result.stderr, /the next round is 1/u);
    result = run({ viewed: allFrames, weakestBeat: "beat 2 is flat", change: "add a splash ring", answers: answersFor(allFrames) });
    assert.equal(result.status, 0, result.stderr);
    const look = JSON.parse(fs.readFileSync(path.join(out, "look.json"), "utf8"));
    assert.equal(look.rounds[0].kind, "stills");
    assert.equal(look.rounds[0].manifestSha256, sha(path.join(out, "stills", "stills.json")));
    assert.equal(look.rounds[0].frames["sheet/contact.png"], sha(path.join(out, "sheet", "contact.png")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("done: a full receipt is DONE; gate PASS alone, one round, or an old manifest is not", () => {
  const full = doneRun();
  try { assert.equal(doneState(full.out).status, "DONE", doneState(full.out).reasons.join("; ")); } finally { fs.rmSync(full.dir, { recursive: true, force: true }); }
  const noLook = doneRun();
  try {
    fs.rmSync(path.join(noLook.out, "look.json"));
    const state = doneState(noLook.out);
    assert.equal(state.status, "NOT DONE");
    assert.match(state.reasons.join(" "), /0 look round\(s\) recorded/u);
  } finally { fs.rmSync(noLook.dir, { recursive: true, force: true }); }
  const single = doneRun({ secondRound: false });
  try { assert.match(doneState(single.out).reasons.join(" "), /1 look round\(s\) recorded/u); } finally { fs.rmSync(single.dir, { recursive: true, force: true }); }
  const stale = doneRun();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(stale.out, "manifest.json"), "utf8"));
    fs.writeFileSync(path.join(stale.out, "manifest.json"), JSON.stringify({ ...manifest, generatedAt: "a later render" }));
    assert.match(doneState(stale.out).reasons.join(" "), /not taken on the final render's own stills/u);
  } finally { fs.rmSync(stale.dir, { recursive: true, force: true }); }
  const partial = doneRun({ lastFrames: ["sheet/contact.png", "poster.png"] });
  try { assert.match(doneState(partial.out).reasons.join(" "), /did not view: stills\/beat-01-mid\.png/u); } finally { fs.rmSync(partial.dir, { recursive: true, force: true }); }
});

test("done: a failing gate is NOT DONE before round 3; a downgrade is recorded", () => {
  const failing = doneRun({ exit: 13 });
  try {
    const state = doneState(failing.out);
    assert.equal(state.status, "NOT DONE");
    assert.match(state.reasons.join(" "), /gate FAIL: TEXT-contrast/u);
  } finally { fs.rmSync(failing.dir, { recursive: true, force: true }); }
  const shorter = doneRun();
  try {
    const treatment = JSON.parse(fs.readFileSync(path.join(shorter.out, "treatment.json"), "utf8"));
    fs.writeFileSync(path.join(shorter.out, ".run", "treatment-first.json"), JSON.stringify({ ...treatment, durationSec: 12 }));
    const state = doneState(shorter.out);
    assert.match(state.downgraded.join(" "), /durationSec dropped from 12 to 4\.2/u);
    const cli = spawnSync(process.execPath, [gate, "--done", shorter.out], { encoding: "utf8" });
    assert.match(cli.stdout, /downgraded: durationSec dropped/u);
  } finally { fs.rmSync(shorter.dir, { recursive: true, force: true }); }
});

test("done: with no vision tool the status is DONE_UNVIEWED (exit 3)", () => {
  const dir = tmp("ltm-unviewed-");
  const out = path.join(dir, "out");
  try {
    writeTreatment(out, fixtureStageTreatment());
    renderRound(out, 1);
    recordLook(out, 1, writeAnswers(dir, { blocked: "no-vision-tool" }));
    renderRound(out, 2, { film: true });
    recordLook(out, 2, writeAnswers(dir, { blocked: "no-vision-tool" }));
    const cli = spawnSync(process.execPath, [gate, "--done", out], { encoding: "utf8" });
    assert.equal(cli.status, 3, cli.stdout);
    assert.match(cli.stdout, /^DONE_UNVIEWED/u);
    assert.match(cli.stdout, /nobody viewed the frames/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("under OpenCode, done needs every viewed frame in a read-tool call; the hook records them", async () => {
  const run = doneRun({ host: "opencode" });
  try {
    let state = doneState(run.out);
    assert.equal(state.status, "NOT DONE");
    assert.match(state.reasons.join(" "), /not opened with the read tool: stills\/beat-01-mid\.png/u);
    const hook = createToolExecuteAfterHook({ projectRoot: run.dir });
    for (const file of [...allFrames, "poster.png"]) await hook({ tool: "read", sessionID: "s", callID: `c-${file}`, args: { filePath: path.join(run.out, file) } }, { title: "", output: "Image read successfully", metadata: {} });
    await hook({ tool: "read", sessionID: "s", callID: "c-text", args: { filePath: path.join(run.out, "treatment.json") } }, { title: "", output: "", metadata: {} });
    const reads = fs.readFileSync(path.join(run.out, ".run", "image-reads.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(reads.length, 7, "only the PNG reads are recorded");
    state = doneState(run.out);
    assert.equal(state.status, "DONE", state.reasons.join("; "));
  } finally { fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test("the read hook ignores files outside a film's output directory and never throws", () => {
  const dir = tmp("ltm-hook-");
  try {
    fs.writeFileSync(path.join(dir, "loose.png"), png(9));
    recordMotionImageRead({ tool: "read", args: { filePath: path.join(dir, "loose.png") } });
    recordMotionImageRead({ tool: "read", args: { filePath: path.join(dir, "missing.png") } });
    recordMotionImageRead({ tool: "edit", args: { filePath: path.join(dir, "loose.png") } });
    recordMotionImageRead({ tool: "read", args: null });
    assert.equal(fs.existsSync(path.join(dir, ".run")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the viewed count in a gate report comes from the look round and survives gate re-runs", () => {
  const dir = tempDir();
  try {
    writeRun(dir);
    const round = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).craftRound;
    fs.writeFileSync(path.join(dir, "look.json"), JSON.stringify({ schemaVersion: 1, rounds: [{ round, kind: "film", frames: Object.fromEntries(allFrames.map((file) => [file, "0".repeat(64)])) }] }));
    for (const options of [{}, {}, { viewed: 0 }]) assert.match(runGate(dir, options).report, /frames actually viewed this run: 6 \(confirmed looked/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
