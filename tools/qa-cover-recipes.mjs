#!/usr/bin/env node
// Cover recipe QA for lit-typographic-motion (needs Chrome, a pre-warmed motion runtime, img2webp and
// dwebp, so it is not part of `npm test`). Each shipped recipe is rendered through the real cover
// renderer (`render.mjs cover`, every gate on the decoded file) from the treatment in its
// expected.json, and fails when it leaves the row it shipped with: median d or the moving share more
// than 15 % off, seamLocal outside the cover TARGET, more than 2 MiB, or a render that exits non-zero.
// `--negatives` also renders the four slide-like negatives and every regression a recipe declares
// (`regressions` in its expected.json). Each of those declares `mustFail` ("G2.floor", "G1.target"):
// it passes only when the render completed and gated the decoded file, every declared gate failed,
// and no undeclared FLOOR gate among G1-G4 failed. A crash, a missing declaration or a failure on the
// wrong gate is a QA failure, never a caught defect. `--feather N` runs only the painted recipe's
// declared `feather-N` regression (the light edge widened from 24 to N painting px).
//
//   node tools/qa-cover-recipes.mjs [--out <dir>] [--only painted-light,weight-tide] [--negatives] [--feather N]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "skills", "lit-typographic-motion");
const { COVER, EXIT } = await import(path.join(skill, "engine", "constants.mjs"));
const FLOOR_GATES = ["G1", "G2", "G3", "G4"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
// The painting the painted recipe's PAINTING block was measured on: the five-panel line-up, kept as a
// test fixture so the README family art can change without moving the recipe's measured bays.
export const PAINTING = path.join(root, "test", "fixtures", "cover", "painted-light-five-panel.png");

/**
 * Verdict of one negative or regression case: { ok, why }. It is proven only when the render
 * completed and gated the decoded file (exit OK or GATE_FAIL_QA, with a manifest), every declared
 * gate failed at its tier, and no undeclared FLOOR gate among G1-G4 failed.
 */
export function judgeCase(mustFail, { status, manifest }) {
  if (!Array.isArray(mustFail) || !mustFail.length) return { ok: false, why: "it declares no gate it must fail (mustFail)" };
  const gates = manifest?.gate?.gates;
  if (!gates || ![EXIT.OK, EXIT.GATE_FAIL_QA].includes(status)) return { ok: false, why: `the render did not complete and gate the decoded file (exit ${status})` };
  for (const id of mustFail) {
    const [gate, tier] = id.split(".");
    if (!gates[gate]) return { ok: false, why: `${gate} was not measured` };
    if ((tier === "target" ? gates[gate].target : gates[gate].pass) !== false) return { ok: false, why: `${id} did not fail` };
  }
  const extra = FLOOR_GATES.filter((gate) => gates[gate]?.pass === false && !mustFail.includes(`${gate}.floor`));
  if (extra.length) return { ok: false, why: `it also fails ${extra.map((gate) => `${gate}.floor`).join(", ")}, which it does not declare` };
  return { ok: true, why: `fails ${mustFail.join(", ")} as declared` };
}

// Every negative shares this treatment; its expected.json sets the loop, the rate and the encode.
const negativeTreatment = (over) => ({
  mode: "cover", request: "A slide-like negative rendered by the cover recipe QA.", idea: "Text states on a timeline that the decoded-file gate has to fail.",
  recipe: "own", recipeReason: "A regression negative that must keep failing, never a recipe.", brandWord: "LITCARD", aspect: "2:1",
  layers: { slow: "Nothing moves slowly.", mid: "Nothing swells.", beat: "Cards and lines change state." },
  system: { rule: "Text states on a timeline.", copies: "One per card or line.", offset: "None." },
  title: { box: [0.1, 0.25, 0.8, 0.5], kind: "live" }, ambition: "It keeps failing its named gates.", ...over
});

function render(outRoot, name, page, treatment, { assets = null, patch = null } = {}) {
  const out = path.join(outRoot, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, "cover"), { recursive: true });
  const html = readFileSync(page, "utf8");
  writeFileSync(path.join(out, "cover", "index.html"), patch ? patch(html) : html);
  if (assets) {
    mkdirSync(path.join(out, "cover", "assets"), { recursive: true });
    cpSync(PAINTING, path.join(out, "cover", "assets", "base.png"));
    writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: assets.map((asset) => ({ ...asset, sha256: sha256(readFileSync(path.join(out, asset.path))) })) }, null, 2) + "\n");
  }
  writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment, null, 2) + "\n");
  const run = spawnSync(process.execPath, [path.join(skill, "render.mjs"), "cover", "--out", out, "--round", "1"], { encoding: "utf8", timeout: 1_800_000, maxBuffer: 16_000_000 });
  return { out, status: run.status, stdout: run.stdout, stderr: run.stderr, manifest: readJson(path.join(out, "manifest.json")) };
}

const near = (value, expected, share) => Math.abs(value - expected) <= share * expected;
const shown = (x) => (typeof x === "number" ? Number(x.toPrecision(4)) : x);
const lastLine = (result) => (result.stderr || result.stdout || "").trim().split("\n").at(-1);

function main() {
  const argv = process.argv.slice(2);
  const option = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
  const outRoot = path.resolve(option("out") ?? mkdtempSync(path.join(os.tmpdir(), "ltm-cover-qa-")));
  const feather = option("feather");
  const only = feather !== undefined ? [] : (option("only") ?? "painted-light,weight-tide,orbit-loop").split(",");
  const rows = [];
  let failed = 0;

  for (const name of only) {
    const dir = path.join(skill, "recipes", name);
    const expected = readJson(path.join(dir, "expected.json"));
    if (!expected?.row) {
      failed += 1;
      rows.push(["FAIL", name, `no expected row in recipes/${name}/expected.json`]);
      continue;
    }
    const result = render(outRoot, name, path.join(dir, "index.html"), expected.treatment, { assets: expected.assets ?? null });
    if (!result.manifest) {
      failed += 1;
      rows.push(["NO RENDER", name, `exit ${result.status}: ${lastLine(result)}`]);
      continue;
    }
    const gate = result.manifest.gate, row = expected.row;
    const misses = [
      ["medianD", near(gate.medianD, row.medianD, 0.15)],
      ["moving", near(gate.movingFrac, row.movingFrac, 0.15)],
      ["seamLocal", gate.seamLocal >= COVER.target.seamLocalMin && gate.seamLocal <= COVER.target.seamLocal],
      ["bytes", result.manifest.bytes <= COVER.targetBytes],
      ["exit", result.status === 0]
    ].filter(([, ok]) => !ok).map(([key]) => key);
    if (misses.length) failed += 1;
    rows.push([misses.length ? `FAIL ${misses.join(",")}` : "PASS", name, `median d ${shown(gate.medianD)} (row ${row.medianD}) | moving ${shown(gate.movingFrac)} | still ${shown(gate.longestStillSec)} s | spike ${shown(gate.spike)} | seamLocal ${shown(gate.seamLocal)} | ${result.manifest.bytes} B | exit ${result.status}`]);
  }

  const cases = [];
  if (argv.includes("--negatives")) {
    for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) cases.push({ kind: "negative", name });
    for (const recipe of ["painted-light", "weight-tide", "orbit-loop"]) {
      for (const id of Object.keys(readJson(path.join(skill, "recipes", recipe, "expected.json"))?.regressions ?? {})) cases.push({ kind: "regression", recipe, id });
    }
  }
  if (feather !== undefined) cases.push({ kind: "regression", recipe: "painted-light", id: `feather-${feather}` });

  for (const c of cases) {
    const label = c.kind === "negative" ? `negative ${c.name}` : `regression ${c.recipe} ${c.id}`;
    let mustFail, result;
    if (c.kind === "negative") {
      const dir = path.join(skill, "recipes", "negatives", c.name);
      const expected = readJson(path.join(dir, "expected.json"));
      if (!expected) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: recipes/negatives/${c.name}/expected.json is missing`]);
        continue;
      }
      mustFail = expected.mustFail;
      result = render(outRoot, `negative-${c.name}`, path.join(dir, "index.html"), negativeTreatment(expected.treatment));
    } else {
      const dir = path.join(skill, "recipes", c.recipe);
      const expected = readJson(path.join(dir, "expected.json"));
      const regression = expected?.regressions?.[c.id];
      if (!regression) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: ${c.recipe}/expected.json declares no regression ${c.id}`]);
        continue;
      }
      if (!readFileSync(path.join(dir, "index.html"), "utf8").includes(regression.patch.find)) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: the page no longer contains "${regression.patch.find}"`]);
        continue;
      }
      mustFail = regression.mustFail;
      result = render(outRoot, `${c.recipe}-${c.id}`, path.join(dir, "index.html"), expected.treatment, { assets: expected.assets ?? null, patch: (html) => html.replace(regression.patch.find, regression.patch.replace) });
    }
    const verdict = judgeCase(mustFail, result);
    if (!verdict.ok) failed += 1;
    const gates = result.manifest?.gate?.gates ?? {};
    const failing = Object.entries(gates).flatMap(([key, g]) => (g.pass === false ? [`${key}.floor`] : g.target === false ? [`${key}.target`] : []));
    const detail = result.manifest ? `; failing ${failing.join(",") || "none"}; ${result.manifest.bytes} B; exit ${result.status}` : `: ${lastLine(result)}`;
    rows.push([verdict.ok ? "PASS (fails as declared)" : "FAIL", label, `${verdict.ok ? "" : "not proven: "}${verdict.why} (declared ${(mustFail ?? []).join(",") || "none"})${detail}`]);
  }

  for (const [verdict, name, detail] of rows) process.stdout.write(`${verdict.padEnd(24)} ${name.padEnd(46)} ${detail}\n`);
  process.stdout.write(`cover recipe QA: ${failed ? `${failed} FAIL` : "all PASS"}; renders in ${outRoot}\n`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
