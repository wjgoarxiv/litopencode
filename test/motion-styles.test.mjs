import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HOUSE_FILE, HOUSE_SCHEMA, readHouse, recordHouse } from "../skills/lit-typographic-motion/engine/house.mjs";
import { LAYOUTS, LAYOUT_IDS, STYLE_IDS, GENRE_STYLE, pickStyle, readStyle, scaleStep, styleCss, styleScript, validateStyle, zonesPx } from "../skills/lit-typographic-motion/engine/styles.mjs";
import { loadTreatment, validateTreatment } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { stageTreatment, typeTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

const fieldOf = (t, options) => validateTreatment(t, options).field;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ltm-style-"));

test("four house styles ship as data and validate", () => {
  assert.deepEqual([...STYLE_IDS], ["swiss-signal", "tidal", "terminalcore", "paper"]);
  for (const id of STYLE_IDS) {
    const style = readStyle(id);
    assert.equal(style.schema, "litopencode.motion-style/v1");
    assert.ok(style.beds.length >= 2 && style.bans.length >= 3, id);
    assert.ok(style.accents.length >= 3, id);
  }
  assert.throws(() => validateStyle({ ...readStyle("paper"), palette: { ...readStyle("paper").palette, ink: "#F3EEE5" } }), /palette\.ink/u);
  assert.throws(() => validateStyle({ ...readStyle("paper"), schema: "litclaude.motion-style/v1" }), /schema/u);
});

test("the style pick is a fixed rule: a name, the house file, a keyword, the genre, then the default", () => {
  assert.equal(pickStyle({ request: "make it in the tidal style" }).source, "request");
  assert.equal(pickStyle({ request: "a terminal hacker intro" }).id, "terminalcore");
  assert.equal(pickStyle({ request: "물결처럼 잔잔한 영상" }).id, "tidal");
  assert.equal(pickStyle({ request: "a cozy handmade look" }).id, "paper");
  assert.equal(pickStyle({ request: "launch film", house: { style: "tidal" } }).id, "tidal");
  assert.equal(pickStyle({ request: "x", genre: "explainer" }).id, "paper");
  assert.equal(pickStyle({ request: "x", genre: "brand-mood" }).id, "tidal");
  assert.equal(pickStyle({ request: "x", genre: "announcement" }).id, "swiss-signal");
  assert.deepEqual({ ...GENRE_STYLE }, { explainer: "paper", "brand-mood": "tidal" });
  // The type path has no paper preset, so an explainer cue there falls back to the default.
  assert.equal(pickStyle({ request: "x", genre: "explainer", path: "type" }).id, "swiss-signal");
  // A keyword that is only part of a longer word does not pick a style.
  assert.equal(pickStyle({ request: "a crtical review", genre: "other" }).id, "swiss-signal");
});

test("the validator holds a stage film to its house style", () => {
  assert.deepEqual(validateTreatment(stageTreatment()), { ok: true });
  assert.equal(fieldOf(stageTreatment({ style: "tidal" })), "style");
  assert.equal(fieldOf(stageTreatment({ style: "no-such-style" })), "style");
  const noStyle = stageTreatment();
  delete noStyle.style;
  assert.equal(fieldOf(noStyle), "style");
  // Off-style palette, face and bed are each refused.
  assert.equal(fieldOf(stageTreatment({ palette: [{ hex: "#10202A", role: "night" }, { hex: "#E8EEF0", role: "copy" }, { hex: "#4FA3A5", role: "water" }] })), "palette");
  assert.equal(fieldOf(stageTreatment({ typePlan: { faces: ["Archivo"], hierarchy: "one line", maxWordsOnScreen: 6 } })), "typePlan");
  assert.equal(fieldOf(stageTreatment({ request: "미니멀한 분위기로 하루 동안 물을 모으는 빗물 정원을 설명하는 영상 만들어줘 lit", register: "minimal", sound: { mode: "generated", plan: "a bed", palette: "pulse", key: "D minor", tempo: 112 } })), "sound");
});

test("the house file pins the next film's style unless the request names another", () => {
  const dir = tmp();
  const out = path.join(dir, "film-2");
  assert.equal(readHouse(out), null);
  recordHouse(out, { style: "tidal", path: "stage", format: "16:9", durationSec: 16 });
  const house = readHouse(out);
  assert.equal(house.schema, HOUSE_SCHEMA);
  assert.equal(path.basename(path.join(dir, HOUSE_FILE)), "motion-house.json");
  assert.equal(house.style, "tidal");
  assert.equal(fs.existsSync(path.join(dir, HOUSE_FILE)), true);
  assert.equal(fieldOf(stageTreatment({ genre: "other", beats: stageTreatment().beats }), { house }), "style");
  // A named style beats the house file; a corrupt file is ignored.
  assert.equal(pickStyle({ request: "paper look please", house }).id, "paper");
  fs.writeFileSync(path.join(dir, HOUSE_FILE), "{not json");
  assert.equal(readHouse(out), null);
  // loadTreatment reads the house file beside the output folder.
  writeTreatment(out, stageTreatment({ style: "paper" }));
  fs.writeFileSync(path.join(dir, HOUSE_FILE), JSON.stringify({ schema: HOUSE_SCHEMA, style: "tidal", films: [] }));
  assert.throws(() => loadTreatment(out), (error) => error.exitCode === 16 && error.field === "style");
});

test("every shot sits on the layout grid and adjacent shots differ", () => {
  assert.deepEqual([...LAYOUT_IDS], ["title", "split", "split-alt", "stage", "hero", "full"]);
  for (const format of ["16:9", "9:16"]) {
    for (const [id, zone] of Object.entries(LAYOUTS[format])) {
      if (!zone.type) continue;
      const [x, y, w, h] = zone.type;
      assert.ok(x >= 0.05 && y >= 0.05 && x + w <= 0.95 && y + h <= 0.95, `${format} ${id} type zone is title-safe`);
    }
  }
  const px = zonesPx("9:16");
  assert.deepEqual(px.stage.type, { x: Math.round(0.09 * 1080), y: Math.round(0.79 * 1920), w: Math.round(0.82 * 1080), h: Math.round(0.13 * 1920) });
  const beats = (patch) => stageTreatment().beats.map((beat, i) => ({ ...beat, ...(patch[i] ?? {}) }));
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 1: { layout: "stage" } }) })), "beats");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 2: { layout: "split" }, 3: { layout: "stage" } }) })), "beats", "four shots use three layouts at least");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 0: { layout: "gallery" } }) })), "beats");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 0: { hero: "" } }) })), "beats");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 0: { transition: "spin" } }) })), "beats");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 3: { transition: "cut" } }) })), "beats", "the last shot ends");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 2: { layout: "full", lines: [0] } }) })), "beats", "a full shot shows no copy");
  assert.equal(fieldOf(stageTreatment({ beats: beats({ 0: { lines: [5] } }) })), "beats");
});

test("30 fps and a preview are the request's to ask for", () => {
  assert.equal(fieldOf(stageTreatment({ fps: 30 })), "fps");
  assert.equal(validateTreatment(stageTreatment({ fps: 30, request: "하루 동안 물을 모으는 빗물 정원을 설명하는 영상 30fps로 만들어줘 lit" })).ok, true);
  assert.equal(fieldOf(stageTreatment({ preview: true })), "preview");
  assert.equal(validateTreatment(stageTreatment({ preview: true, request: "하루 동안 물을 모으는 빗물 정원을 설명하는 영상, 스토리보드 먼저 보여줘 lit" })).ok, true);
  assert.equal(fieldOf(stageTreatment({ preview: "yes" })), "preview");
});

test("the type path takes its style's preset and needs no shot grid", () => {
  assert.deepEqual(validateTreatment(typeTreatment()), { ok: true });
  assert.equal(fieldOf(typeTreatment({ style: "paper" })), "style");
});

test("style.css and style.js carry the tokens and the pixel zones to the page", () => {
  const style = readStyle("swiss-signal");
  const css = styleCss(style, "16:9");
  assert.match(css, /--lit-ground: #0C0E13/u);
  assert.match(css, /\.lit-display \{[^}]*font-family: "Archivo"/u);
  assert.match(css, /word-break: keep-all/u);
  const script = styleScript(style, "16:9", stageTreatment());
  const window = {};
  new Function("window", script)(window);
  assert.equal(window.LitStyle.id, "swiss-signal");
  assert.equal(window.LitTimeline.beats.length, 4);
  assert.equal(window.LitTimeline.beats[1].layout, "split");
  assert.ok(window.LitStyle.zones.hero.type.w > 1000);
  assert.equal(scaleStep(style, "16:9", style.scale["16:9"].headline), "headline");
  assert.equal(scaleStep(style, "16:9", 1), null);
});
