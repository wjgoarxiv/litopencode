import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { checkAssets } from "../skills/lit-typographic-motion/engine/cover/assets.mjs";
import { coverChromeFlags } from "../skills/lit-typographic-motion/engine/cover/capture.mjs";
import { RECIPES, loadCoverTreatment, validateCoverTreatment } from "../skills/lit-typographic-motion/engine/cover/treatment.mjs";
import { coverTreatment } from "../test-support/motion-cover.mjs";

// The 3D hero cover: the hero-3d recipe, its hero and beat, the product a link names, the fetched asset
// source, the GPU rung, and the seeded entropy a three.js scene needs while it builds.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const refused = (t, field) => {
  const result = validateCoverTreatment(t);
  assert.equal(result.ok, false, `expected a refusal at ${field}`);
  assert.equal(result.field, field, result.detail);
  return result.detail;
};
const link = "https://github.com/acme/rocket";
const sha = "b".repeat(64);

test("hero-3d is a cover recipe, and every cover names its hero and the one beat it acts", () => {
  assert.ok(RECIPES.includes("hero-3d"));
  assert.equal(validateCoverTreatment(coverTreatment({ recipe: "hero-3d" })).ok, true);
  const noHero = coverTreatment();
  delete noHero.hero;
  refused(noHero, "hero");
  const noBeat = coverTreatment();
  noBeat.beat = "  ";
  refused(noBeat, "beat");
  refused(coverTreatment({ hero: "One. Two. Three." }), "hero");
});

test("a link in the request makes the cover's product required, and it must be that link", () => {
  const request = `Make a README motion cover for ${link} please.`;
  assert.match(refused(coverTreatment({ request }), "product"), /assets --out <dir> --url <link> --cover/u);
  assert.equal(validateCoverTreatment(coverTreatment({ request, product: { name: "Rocket", url: `${link}/` } })).ok, true);
  refused(coverTreatment({ request, product: { name: "Rocket", url: "https://github.com/acme/other" } }), "product.url");
  refused(coverTreatment({ product: { name: " ", url: link } }), "product.name");
  assert.equal(validateCoverTreatment(coverTreatment()).ok, true, "no link, no product");
});

test("loading a cover with a product needs the fetched product.json, kept under cover/assets, and an unreachable product exits 22", () => {
  const out = tmp("lit-hero-product-");
  try {
    const request = `Make a README motion cover for ${link} please.`;
    const write = (treatment) => fs.writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment));
    write(coverTreatment({ request, product: { name: "Rocket", url: link } }));
    assert.throws(() => loadCoverTreatment(out), (error) => error.exitCode === 16 && error.field === "product" && /no .*product\.json/u.test(error.message));
    fs.writeFileSync(path.join(out, "product.json"), JSON.stringify({ product: { assets: [{ path: "stage/assets/01-logo.png" }] } }));
    assert.throws(() => loadCoverTreatment(out), (error) => error.exitCode === 16 && /outside cover\/assets/u.test(error.message));
    fs.writeFileSync(path.join(out, "product.json"), JSON.stringify({ product: { assets: [{ path: "cover/assets/01-logo.png" }] } }));
    assert.equal(loadCoverTreatment(out).product.name, "Rocket");
    write(coverTreatment({ request, product: { name: "Rocket", url: link, unreachable: "offline" } }));
    assert.throws(() => loadCoverTreatment(out), (error) => error.exitCode === 22 && /BLOCKED_ASSET_MISSING/u.test(error.message) && /ask the user/u.test(error.message));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

// A cover folder with one raster, listed in assets.json with the given source and role.
function coverWithArt({ source, role = "base-art" }) {
  const out = tmp("lit-hero-assets-");
  fs.mkdirSync(path.join(out, "cover", "assets"), { recursive: true });
  const bytes = Buffer.from("not really a png");
  fs.writeFileSync(path.join(out, "cover", "assets", "base.png"), bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role, source, sha256: hash, box: [0, 0, 1, 1] }] }));
  return out;
}

test("assets.json takes the fetched source, and painted-light needs a base art the user supplied", () => {
  const rasters = [{ rel: "assets/base.png" }];
  for (const source of ["user", "fetched", "generated"]) {
    const out = coverWithArt({ source, role: "logo" });
    try { assert.equal(checkAssets({ out, treatment: { recipe: "orbit-loop" }, rasters }).length, 1, source); } finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  const bad = coverWithArt({ source: "drawn", role: "logo" });
  try { assert.throws(() => checkAssets({ out: bad, treatment: { recipe: "orbit-loop" }, rasters }), (error) => error.exitCode === 16 && /fetched/u.test(error.message)); } finally { fs.rmSync(bad, { recursive: true, force: true }); }
  for (const source of ["fetched", "generated"]) {
    const out = coverWithArt({ source });
    try { assert.throws(() => checkAssets({ out, treatment: { recipe: "painted-light" }, rasters }), (error) => error.exitCode === 22 && /hero-3d/u.test(error.message), source); } finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  const user = coverWithArt({ source: "user" });
  try { assert.equal(checkAssets({ out: user, treatment: { recipe: "painted-light" }, rasters }).length, 1); } finally { fs.rmSync(user, { recursive: true, force: true }); }
});

test("the cover browser asks the GPU rung for a hero-3d cover and keeps raster on the CPU there too", () => {
  const gpu = coverChromeFlags(1200, 600, 2, "gpu");
  assert.ok(gpu.includes("--force-device-scale-factor=2") && gpu.includes("--disable-gpu-rasterization") && gpu.includes("--disable-partial-raster"));
  assert.equal(gpu.some((flag) => /swiftshader|enable-gpu-rasterization/u.test(flag)), false);
  assert.equal(gpu.filter((flag) => flag === "--disable-gpu-rasterization").length, 1, "no flag twice");
  assert.ok(coverChromeFlags(1200, 600, 2).includes("--use-angle=swiftshader"));
});

test("the cover init script seeds Math.random while the page builds and refuses it once the page is ready", () => {
  const make = () => {
    const style = { textContent: "" };
    class Performance {}
    Performance.prototype.now = () => 1;
    const sandbox = { Math: Object.create(Math), Date, Performance, performance: new Performance(), crypto: { getRandomValues: () => {} }, document: { documentElement: { appendChild: () => {} }, head: { appendChild: () => {} }, createElement: () => style, addEventListener: () => {} } };
    sandbox.window = sandbox;
    sandbox.requestAnimationFrame = () => 1;
    sandbox.setInterval = () => 1;
    vm.runInNewContext(fs.readFileSync(path.join(skillRoot, "engine", "stage", "cover-init.js"), "utf8"), sandbox);
    return sandbox;
  };
  const a = make(), b = make();
  const draw = (sandbox) => [0, 1, 2, 3].map(() => vm.runInNewContext("Math.random()", sandbox));
  const first = draw(a);
  assert.deepEqual(first, draw(b), "the same sequence in every browser");
  assert.ok(first.every((value) => value >= 0 && value < 1) && new Set(first).size === 4);
  assert.deepEqual([...a.__litCover.used()], [], "building the scene is not misuse");
  a.ready = true;
  assert.throws(() => vm.runInNewContext("Math.random()", a), /is not available in a cover page/u);
  assert.deepEqual([...a.__litCover.used()], ["Math.random"]);
});

test("the hero-3d recipe ships a page on the pinned three.js map and an expected row inside the cover TARGET", () => {
  const dir = path.join(skillRoot, "recipes", "hero-3d");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, /<script type="importmap">\{ "imports": \{ "three": "\/lit\/three\/three\.module\.js", "three\/addons\/": "\/lit\/three\/addons\/" \} \}<\/script>/u);
  assert.match(html, /window\.renderFrame = /u);
  assert.match(html, /window\.ready = true/u);
  assert.doesNotMatch(html, /Math\.random\(|Date\.now\(|performance\.now\(|requestAnimationFrame\(/u);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  assert.equal(expected.treatment.recipe, "hero-3d");
  assert.equal(validateCoverTreatment(expected.treatment).ok, true);
  assert.match(expected.treatment.brandWord, /^LITOPENCODE$/u);
});
