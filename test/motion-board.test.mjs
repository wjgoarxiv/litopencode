import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BOARD, boardGrid, boardHtml, boardRules } from "../skills/lit-typographic-motion/engine/board.mjs";
import { demoPage, demoTreatment } from "../skills/lit-typographic-motion/engine/gallery.mjs";
import { requiredFrames } from "../skills/lit-typographic-motion/engine/look.mjs";
import { encodePng, decodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { linesPerShot, scaffoldHtml } from "../skills/lit-typographic-motion/engine/scaffold.mjs";
import { STYLE_IDS } from "../skills/lit-typographic-motion/engine/styles.mjs";
import { validateTreatment } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { recordMotionImageRead } from "../src/motion-image-reads.ts";
import { stageTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

// The storyboard round and the scaffold: the page the model starts from, the board that proves the
// layout before a film is encoded, and the done check for a film whose request ends at the preview.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const gate = path.join(skillRoot, "gate.mjs");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const needsWarm = warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch the stage";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cli = (args, env = {}) => spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed, ...env }, timeout: 600_000 });

test("every house style's demo treatment is valid in both formats, with four shots on four layouts", () => {
  for (const id of STYLE_IDS) for (const format of ["16:9", "9:16"]) {
    const t = demoTreatment(id, format);
    assert.deepEqual(validateTreatment(t), { ok: true }, `${id} ${format}`);
    assert.equal(new Set(t.beats.map((beat) => beat.layout)).size, 4);
  }
});

test("the scaffold puts each copy line in its shot, skips full shots and reads the style from /lit/", () => {
  const t = demoTreatment("paper");
  const html = scaffoldHtml(t);
  for (const href of ["/lit/fonts.css", "/lit/style.css", "/lit/style.js", "/lit/stage-kit.js"]) assert.ok(html.includes(href), href);
  assert.equal((html.match(/data-shot="/gu) ?? []).length, 4);
  assert.equal((html.match(/data-copy="/gu) ?? []).length, 4);
  assert.match(html, /const COPY = \[\s+"작게 시작해서 끝까지"/u);
  assert.doesNotMatch(html, /https?:\/\//u, "the page needs no network");
  const full = structuredClone(t);
  full.beats[1].layout = "full";
  delete full.beats[1].lines;
  full.beats.forEach((b) => delete b.lines);
  const spread = linesPerShot(full);
  assert.deepEqual(spread[1], [], "a full shot shows no copy");
  assert.deepEqual(spread.flat().sort(), [0, 1, 2, 3], "every line still lands on a shot with a type zone");
});

test("the scaffold CLI writes stage/index.html from the treatment and never replaces a page", () => {
  const dir = tmp("ltm-scaffold-");
  try {
    const out = path.join(dir, "out");
    writeTreatment(out, demoTreatment("tidal"));
    const first = cli([render, "scaffold", "--out", out]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /SCAFFOLD: .*index\.html \(style tidal, 4 shots\)/u);
    assert.match(fs.readFileSync(path.join(out, "stage", "index.html"), "utf8"), /DRAW = \[/u);
    fs.writeFileSync(path.join(out, "stage", "index.html"), "<!doctype html><title>mine</title>");
    const second = cli([render, "scaffold", "--out", out]);
    assert.equal(second.status, 2);
    assert.match(second.stderr, /scaffold never overwrites a page/u);
    assert.equal(fs.readFileSync(path.join(out, "stage", "index.html"), "utf8"), "<!doctype html><title>mine</title>");
    const typeOut = path.join(dir, "type");
    fs.mkdirSync(typeOut);
    fs.writeFileSync(path.join(typeOut, "treatment.json"), JSON.stringify(stageTreatment({ path: "type", style: "swiss-signal" })));
    assert.equal(cli([render, "scaffold", "--out", typeOut]).status, 16, "a type treatment has no stage page to scaffold");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the board grid fits n shots of either format inside the page, and its rules mirror the gate rows", () => {
  for (const n of [1, 3, 4, 6, 9, 12]) for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    const g = boardGrid(n, w, h);
    assert.ok(g.cols * g.rows >= n && g.tw > 0 && g.th > 0, `${n} ${w}x${h}`);
    assert.ok(g.cols * g.tw + (g.cols - 1) * BOARD.gap <= BOARD.width - 2 * BOARD.margin + 1, "fits the width");
    assert.ok(BOARD.header + g.rows * (g.th + BOARD.caption) + (g.rows - 1) * BOARD.gap <= BOARD.height - BOARD.footer + BOARD.margin, "fits the height");
  }
  const rules = boardRules({ "TEXT-ZONE": { pass: false, detail: "x" }, "TEXT-decor": { pass: true, detail: "y" }, "DEAD-AIR": { pass: true, na: true, detail: "z" }, "TEXT-meta-labels": { pass: false, warn: true, detail: "w" } });
  assert.deepEqual(rules.map((r) => [r.id, r.status]), [["TEXT-ZONE", "FAIL"], ["TEXT-decor", "PASS"], ["TEXT-meta-labels", "WARN"]]);
  const t = demoTreatment("swiss-signal");
  assert.match(boardHtml({ treatment: t, stills: ["a.png", "b.png", "c.png", "d.png"], rules }), /layout check: FAIL — TEXT-ZONE/u);
  assert.match(boardHtml({ treatment: t, stills: ["a.png"], rules: [] }), /layout check: PASS/u);
  assert.match(boardHtml({ treatment: t, stills: ["a.png"] }), /layout check: not run/u);
});

test("the storyboard is a required view, and the read hook finds it inside stills/", () => {
  const files = ["stills/board.png", "stills/beat-01-mid.png", "stills/cut-01-strip.png", "sheet/contact.png", "stills/check.json"];
  assert.deepEqual(requiredFrames({ files }).sort(), ["sheet/contact.png", "stills/beat-01-mid.png", "stills/board.png", "stills/cut-01-strip.png"]);
  const dir = tmp("ltm-board-read-");
  try {
    fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".run"));
    fs.writeFileSync(path.join(dir, "treatment.json"), "{}");
    fs.writeFileSync(path.join(dir, "stills", "stills.json"), "{}");
    fs.writeFileSync(path.join(dir, "stills", "board.png"), encodePng(2, 2, Buffer.alloc(16, 7), 4, 1));
    recordMotionImageRead({ tool: "read", args: { filePath: path.join(dir, "stills", "board.png") } });
    const reads = fs.readFileSync(path.join(dir, ".run", "image-reads.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(reads[0].file, "stills/board.png");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the preview request is done at its board ----
function previewRun(dir, { board = true, check = [{ id: "TEXT-ZONE", status: "PASS" }], look = true, viewBoard = true } = {}) {
  const t = stageTreatment({ request: "하루 동안 물을 모으는 빗물 정원을 설명하는 영상 만들어줘, 스토리보드 먼저 보여줘 lit", preview: true });
  writeTreatment(dir, t);
  fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sheet"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".run"), { recursive: true });
  const png = (n) => encodePng(2, 2, Buffer.alloc(16, n), 4, 1);
  const files = [["stills/beat-01-mid.png", "beat"], ["sheet/contact.png", "sheet"], ...(board ? [["stills/board.png", "board"]] : [])];
  for (const [i, [file]] of files.entries()) fs.writeFileSync(path.join(dir, file), png(i + 1));
  fs.writeFileSync(path.join(dir, "stills", "stills.json"), JSON.stringify({ schemaVersion: 1, path: "stage", round: 1, files: files.map(([file, kind]) => ({ file, kind, sha256: sha(path.join(dir, file)) })) }));
  if (check) fs.writeFileSync(path.join(dir, "stills", "check.json"), JSON.stringify({ rules: check }));
  if (look) {
    const viewed = files.map(([file]) => file).filter((file) => viewBoard || file !== "stills/board.png");
    fs.writeFileSync(path.join(dir, "look.json"), JSON.stringify({ rounds: [{ round: 1, kind: "stills", manifestSha256: sha(path.join(dir, "stills", "stills.json")), frames: Object.fromEntries(viewed.map((file) => [file, sha(path.join(dir, file))])), answers: [], needsAnotherRound: [] }] }));
  }
}
const done = (dir) => spawnSync(process.execPath, [gate, "--done", dir], { encoding: "utf8" });

test("a film that asked for a preview is DONE at a passing, looked-at board; the full render waits", () => {
  const dir = tmp("ltm-preview-done-");
  try {
    previewRun(dir);
    const r = done(dir);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^DONE/u);
    assert.match(r.stdout, /storyboard preview .*board\.png.*not rendered yet.*go/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the preview done check wants the board, a passing check, a look round and the board viewed", () => {
  const cases = [
    [{ board: false }, /no storyboard/u],
    [{ check: [{ id: "TEXT-OVERLAP", status: "FAIL" }] }, /board check failed \(TEXT-OVERLAP\)/u],
    [{ check: null }, /stills\/check\.json\) is missing/u],
    [{ look: false }, /no look round on the board/u],
    [{ viewBoard: false }, /did not view: stills\/board\.png/u]
  ];
  for (const [options, expected] of cases) {
    const dir = tmp("ltm-preview-not-");
    try {
      previewRun(dir, options);
      const r = done(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, expected);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// ---- real renders (a pre-warmed cache) ----
test("a board round on the scaffolded demo passes: storyboard drawn, check written, exit 0", { skip: needsWarm }, () => {
  const dir = tmp("ltm-board-pass-");
  try {
    const out = path.join(dir, "out");
    const t = demoTreatment("paper");
    writeTreatment(out, t);
    fs.mkdirSync(path.join(out, "stage"), { recursive: true });
    fs.writeFileSync(path.join(out, "stage", "index.html"), demoPage(t));
    const r = cli([render, "stage", "--out", out, "--round", "1", "--stills-only"]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /storyboard: .*board\.png/u);
    assert.match(r.stdout, /board check PASS/u);
    const board = decodePng(fs.readFileSync(path.join(out, "stills", "board.png")));
    assert.deepEqual([board.width, board.height], [BOARD.width, BOARD.height]);
    const index = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
    const entry = index.files.find((f) => f.kind === "board");
    assert.equal(entry.file, "stills/board.png");
    assert.equal(entry.sha256, sha(path.join(out, "stills", "board.png")));
    const rules = JSON.parse(fs.readFileSync(path.join(out, "stills", "check.json"), "utf8")).rules;
    assert.deepEqual(rules.filter((rule) => rule.status === "FAIL"), []);
    for (const id of ["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE"]) assert.ok(rules.some((rule) => rule.id === id && rule.status === "PASS"), id);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a board round on swiss-signal passes its font row: a display line at weight 900 draws with a face the style owns", { skip: needsWarm }, () => {
  const dir = tmp("ltm-board-fonts-");
  try {
    const out = path.join(dir, "out");
    const t = demoTreatment("swiss-signal");
    writeTreatment(out, t);
    fs.mkdirSync(path.join(out, "stage"), { recursive: true });
    fs.writeFileSync(path.join(out, "stage", "index.html"), demoPage(t));
    const r = cli([render, "stage", "--out", out, "--round", "1", "--stills-only"]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const rules = JSON.parse(fs.readFileSync(path.join(out, "stills", "check.json"), "utf8")).rules;
    assert.deepEqual(rules.filter((rule) => rule.status === "FAIL"), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("RED: a board round whose page stacks two copy lines fails with exit 13, still draws the board and names the rule", { skip: needsWarm }, () => {
  const dir = tmp("ltm-board-fail-");
  try {
    const out = path.join(dir, "out");
    const t = demoTreatment("swiss-signal");
    t.beats[1].lines = [1, 2];
    writeTreatment(out, t);
    fs.mkdirSync(path.join(out, "stage"), { recursive: true });
    fs.writeFileSync(path.join(out, "stage", "index.html"), demoPage(t).replace("</style>", "  .type p { position: absolute; left: 0; top: 0; }\n</style>"));
    const r = cli([render, "stage", "--out", out, "--round", "1", "--stills-only"]);
    assert.equal(r.status, 13, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /BOARD_CHECK_FAIL \(13\): .*TEXT-OVERLAP/u);
    assert.ok(fs.existsSync(path.join(out, "stills", "board.png")), "the board is drawn so the failure can be seen");
    const rules = JSON.parse(fs.readFileSync(path.join(out, "stills", "check.json"), "utf8")).rules;
    assert.equal(rules.find((rule) => rule.id === "TEXT-OVERLAP").status, "FAIL");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the styles gallery renders a board per house style and one comparison sheet", { skip: needsWarm }, () => {
  const dir = tmp("ltm-styles-");
  try {
    const out = path.join(dir, "gallery");
    const r = cli([render, "styles", "--out", out]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    for (const id of STYLE_IDS) {
      assert.ok(fs.existsSync(path.join(out, id, "stills", "board.png")), id);
      assert.match(r.stdout, new RegExp(`${id}: board check PASS`, "u"));
    }
    const sheet = decodePng(fs.readFileSync(path.join(out, "styles.png")));
    assert.ok(sheet.width >= 1920 && sheet.height >= 1080);
    assert.equal(cli([render, "styles", "--out", out, "--format", "4:3"]).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
