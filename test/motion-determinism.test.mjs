import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findChrome } from "../skills/lit-typographic-motion/engine/browser.mjs";
import { typeTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

// MO-C-09 / MO-A-24 / MO-A-25: byte-identical rgbaSha256 across independent processes, on the
// hardware rung and under SwiftShader, and a seeked frame equal to the same frame rendered
// sequentially, including a stateful (CRT persistence) shot that needs preroll.
const render = path.resolve("skills", "lit-typographic-motion", "render.mjs");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const chrome = findChrome();
const skip = !chrome.path ? `Chrome is absent: ${chrome.missing}` : !warmed ? "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache" : false;

function plan(dir, brief) {
  fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief));
  writeTreatment(path.join(dir, "out"), typeTreatment());
  const result = spawnSync(process.execPath, [render, "film", "--brief", path.join(dir, "brief.json"), "--out", path.join(dir, "out"), "--stills-only"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed }, timeout: 600_000 });
  assert.equal(result.status, 0, result.stderr);
  return path.join(dir, "out", ".run", "plan.json");
}

function hashes(dir, planFile, frames, samples, rung) {
  const result = spawnSync(process.execPath, [render, "frames", "--brief", path.join(dir, "brief.json"), "--out", path.join(dir, `f-${rung}-${frames.join("_")}`), "--plan", planFile,
    "--frames", frames.join(","), "--samples", String(samples), "--shutter", "0.5", "--rung", rung], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed }, timeout: 600_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)).hashes;
}

test("two independent processes give identical frame hashes on the hardware rung and under SwiftShader", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-determinism-"));
  try {
    const planFile = plan(dir, { title: "Same Twice", scenes: [{ scene: "title-slam", text: "Same Twice" }, { scene: "karaoke", text: "두 번 렌더해도 같은 바이트" }] });
    for (const rung of ["gpu", "swiftshader"]) {
      const a = hashes(dir, planFile, [10, 80, 140], 2, rung);
      const b = hashes(dir, planFile, [10, 80, 140], 2, rung);
      assert.deepEqual(a, b, rung);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a seeked frame equals the sequential frame, including a stateful shot that needs preroll", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-seek-"));
  try {
    const planFile = plan(dir, { title: "terminal check", preset: "terminalcore", scenes: [{ scene: "title-slam", text: "BOOT OK" }, { scene: "kinetic-list", items: ["LINK", "READY"] }] });
    const planData = JSON.parse(fs.readFileSync(planFile, "utf8"));
    assert.ok(planData.timeline.some((entry) => entry.stateful), "the terminal plan has a stateful shot");
    const sequential = hashes(dir, planFile, [95, 96, 97, 98, 99, 100], 2, "gpu");
    const seeked = hashes(dir, planFile, [100], 2, "gpu");
    assert.equal(seeked[100], sequential[100]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
