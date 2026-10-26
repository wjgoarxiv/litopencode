import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTreatment, registerOf, asksCalm, asksPathTraced, soundModes, scoreGenres } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { FILL_GRID } from "../skills/lit-typographic-motion/engine/fill.mjs";
import { richFill } from "../skills/lit-typographic-motion/engine/stage/qa.mjs";
import { stageTreatment, typeTreatment } from "../test-support/motion-treatment.mjs";

// The register (rich by default, minimal only when the request asks for calm), the score as a rich
// film's sound, and the RICH-FILL gate row that checks a rich film is actually full.
const refused = (t, field) => {
  const result = validateTreatment(t);
  assert.equal(result.ok, false, `expected a refusal at ${field}`);
  assert.equal(result.field, field, result.detail);
  return result.detail;
};
const calmRequest = "미니멀한 분위기로 하루 동안 물을 모으는 빗물 정원을 설명하는 영상 만들어줘 lit";

test("a stage film is rich unless the request asks for calm, and then it must say minimal", () => {
  assert.equal(registerOf(stageTreatment()), "rich");
  assert.deepEqual(validateTreatment(stageTreatment({ register: "rich" })), { ok: true });
  assert.match(refused(stageTreatment({ register: "minimal" }), "register"), /only when the request asks/u);
  refused(stageTreatment({ register: "loud" }), "register");
  assert.match(refused(stageTreatment({ request: calmRequest }), "register"), /calm or minimal film: register minimal/u);
  const calm = stageTreatment({ request: calmRequest, register: "minimal", sound: { mode: "generated", plan: "a bed", palette: "warm", key: "F major", tempo: 96 } });
  assert.deepEqual(validateTreatment(calm), { ok: true });
  assert.equal(asksCalm("a calm film"), true);
  assert.equal(asksCalm("차분한 영상"), true);
  assert.equal(asksCalm("a loud, busy film"), false);
});

test("the type path takes no register: its words are the film", () => {
  assert.deepEqual(validateTreatment(typeTreatment()), { ok: true });
  refused(typeTreatment({ register: "rich" }), "register");
});

test("a rich film scores its own music; the style's preset beds belong to minimal films", () => {
  assert.ok(soundModes.includes("score"));
  assert.deepEqual(validateTreatment(stageTreatment()), { ok: true });
  assert.match(refused(stageTreatment({ sound: { mode: "generated", plan: "a bed", palette: "warm", key: "F major", tempo: 96 } }), "sound"), /mode score/u);
  refused(stageTreatment({ sound: { mode: "score", plan: "  " } }), "sound");
  for (const genre of scoreGenres) assert.deepEqual(validateTreatment(stageTreatment({ sound: { mode: "score", plan: "layered", genre } })), { ok: true }, genre);
  assert.match(refused(stageTreatment({ sound: { mode: "score", plan: "layered", genre: "polka" } }), "sound"), /genre/u);
  assert.deepEqual(validateTreatment(stageTreatment({ sound: { mode: "supplied", plan: "the user's track", file: "track.wav" } })), { ok: true });
});

test("the Blender rung is a 3D world with the offline renderer, and only a request for path-traced quality asks for it", () => {
  const solid = (extra = {}) => stageTreatment({ depth: "3d", visualDevices: [{ kind: "depth3d", role: "subject", beats: [0, 1, 2, 3] }, { kind: "diagram", role: "support", beats: [1, 2] }, { kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }], ...extra });
  assert.deepEqual(validateTreatment(solid({ render3d: "blender" })), { ok: true });
  refused(solid({ render3d: "cycles" }), "render3d");
  refused(stageTreatment({ render3d: "blender" }), "depth");
  assert.equal(asksPathTraced("고퀄 3D 영상 만들어줘"), true);
  assert.equal(asksPathTraced("make a path-traced hero shot"), true);
  assert.equal(asksPathTraced("make a short product film"), false);
});

// ---- RICH-FILL: 12 regions (4 x 3) per shot midpoint; a rich film leaves at most 2 empty in all but one shot ----
const empty = (n) => Array.from({ length: FILL_GRID.cols * FILL_GRID.rows }, (_, i) => (i < n ? 0.02 : 0.7));
const shots = (counts) => counts.map((n, beat) => ({ beat, regions: empty(n) }));

test("RICH-FILL passes a rich film whose shots fill the frame, and lets one shot (the end card) breathe", () => {
  assert.equal(richFill({ treatment: stageTreatment(), mids: shots([0, 1, 2, 2]) }).pass, true);
  assert.equal(richFill({ treatment: stageTreatment(), mids: shots([0, 1, 2, 7]) }).pass, true, "one thin shot");
});

test("RICH-FILL fails a rich film with more than 2 of 12 regions empty in more than one shot", () => {
  const row = richFill({ treatment: stageTreatment(), mids: shots([0, 3, 2, 6]) });
  assert.equal(row.pass, false);
  assert.match(row.detail, /shot 2 has 3 of 12 regions empty/u);
  assert.match(row.detail, /shot 4 has 6 of 12/u);
});

test("RICH-FILL is not applied to a minimal film and says when it was not measured", () => {
  const calm = stageTreatment({ request: calmRequest, register: "minimal", sound: { mode: "generated", plan: "a bed", palette: "warm", key: "F major", tempo: 96 } });
  const minimal = richFill({ treatment: calm, mids: shots([9, 9, 9, 9]) });
  assert.equal(minimal.pass, true);
  assert.equal(minimal.na, true);
  assert.equal(richFill({ treatment: stageTreatment(), mids: [] }).na, true);
});
