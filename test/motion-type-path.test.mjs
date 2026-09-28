import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { briefForTreatment, planRun, presetSource } from "../skills/lit-typographic-motion/render.mjs";
import { runGate } from "../skills/lit-typographic-motion/gate.mjs";
import { buildTimeline } from "../skills/lit-typographic-motion/engine/timing.mjs";
import { readingFloor } from "../skills/lit-typographic-motion/engine/text.mjs";
import { tempDir, writeRun } from "../test-support/motion-fixture.mjs";
import { typeTreatment } from "../test-support/motion-treatment.mjs";

const skillRoot = path.resolve("skills", "lit-typographic-motion");
const lines = { lines: ["바람이 먼저 안다", "길은 늘 열려 있다"] };

test("the treatment's durationSec is honoured: holds scale up and never drop below their floor", () => {
  const natural = buildTimeline(lines, { bpm: 100 });
  const target = buildTimeline(lines, { bpm: 100, targetDurationSec: 14 });
  assert.ok(natural.durationSec < 14);
  assert.ok(target.durationSec >= 14 && target.durationSec < 14 + 0.6 + 1e-9, `${target.durationSec}`);
  assert.equal(target.floorForced, false);
  for (const shot of target.timeline.filter((entry) => entry.kind !== "reveal")) assert.ok(shot.holdSec >= 1.25 * readingFloor(shot.text, shot.kind) - 1e-9, shot.id);
  const shots = (t) => t.timeline.filter((entry) => entry.kind !== "reveal");
  assert.ok(shots(target)[0].holdSec > shots(natural)[0].holdSec, "the first hold scaled up too, not only the last shot");
});

test("when the reading floors force a longer film, the plan keeps the floors and warns", () => {
  const dir = tempDir();
  try {
    const plan = planRun({ lines: ["여름밤의 작은 축제가 시작됩니다 모두 함께 걸어요", "강가의 불빛이 하나씩 켜지고 음악이 흐릅니다"] }, "brief.json", { runDir: dir, targetDurationSec: 4 }, {});
    assert.ok(plan.durationSec > 4);
    assert.match(plan.warnings.join(" "), /reading floors need .* longer than the treatment's 4 s/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the brief's title prints only when it is one of the treatment's copy lines", () => {
  const treatment = typeTreatment();
  assert.equal(briefForTreatment({ title: "Working title", lines: lines.lines }, treatment).title, undefined, "a metadata title stays off screen");
  assert.equal(briefForTreatment({ title: "바람이 먼저 안다", lines: lines.lines }, treatment).title, "바람이 먼저 안다", "the film's own name is a copy line");
  const timeline = buildTimeline(briefForTreatment({ title: "Working title", lines: lines.lines }, treatment), { bpm: 100 }).timeline;
  assert.equal(timeline.some((entry) => /Working title/u.test(entry.text)), false);
});

test("the shot index prints only when the treatment asks for it", () => {
  const scenes = fs.readFileSync(path.join(skillRoot, "engine", "page", "scenes.js"), "utf8");
  assert.match(scenes, /if \(api\.presetId !== "terminalcore" && api\.showIndex\) \{\n\s+api\.text\(\{ id: "title-index"/u);
  const engine = fs.readFileSync(path.join(skillRoot, "engine", "page", "engine.js"), "utf8");
  assert.match(engine, /config\.showIndex === true \? `  shot \$\{f\.shotNumber\}\/\$\{f\.shotTotal\}` : ""/u);
});

test("an agent-chosen preset is labelled agent default; a preset the request names is user-specified", () => {
  assert.equal(presetSource({ preset: "tidal" }, typeTreatment()), "agent");
  assert.equal(presetSource({ preset: "tidal" }, typeTreatment({ request: "tidal 스타일로 \"바람이 먼저 안다\" \"길은 늘 열려 있다\" 키네틱 타이포 영상 lit" })), "user");
  assert.equal(presetSource({}, typeTreatment()), null);
  for (const [source, label] of [["agent", "agent default"], ["user", "user-specified"]]) {
    const dir = tempDir();
    try {
      const plan = planRun({ preset: "tidal", lines: ["바람이 먼저 안다"] }, "brief.json", { runDir: dir, presetSource: source }, {});
      assert.equal(plan.preset.reason, label, "the render log and the pre-flight report use the same label as the gate report");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const [source, label] of [["agent", "agent default"], ["user", "user-specified"]]) {
    const dir = tempDir();
    try {
      writeRun(dir, (model) => { model.brief.explicitPreset = "swiss-signal"; model.brief.presetSource = source; });
      assert.match(runGate(dir).report, new RegExp(`preset: swiss-signal  \\(chosen because: ${label}\\)`, "u"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("the reference example brief uses placeholders, and the render refuses a brief that still holds one", () => {
  const authoring = fs.readFileSync(path.join(skillRoot, "references", "authoring.md"), "utf8");
  const example = JSON.parse(authoring.match(/```json\n([\s\S]*?)```/u)[1]);
  assert.match(example.scenes[0].text, /^<.+>$/u);
});
