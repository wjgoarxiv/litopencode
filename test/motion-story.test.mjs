import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTreatment } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { stageTreatment, typeTreatment } from "../test-support/motion-treatment.mjs";

// The story, the protagonist, the named product and the 3D route of a stage film. Each test breaks one
// field of a valid treatment and expects the first refusal to name that field.
const refused = (t, field) => {
  const result = validateTreatment(t);
  assert.equal(result.ok, false, `expected a refusal at ${field}`);
  assert.equal(result.field, field, result.detail);
  return result.detail;
};
const link = "https://github.com/acme/rocket";
const sha = "a".repeat(64);
const productFilm = (extra = {}) => stageTreatment({
  request: `${link} 이 프로젝트를 소개하는 영상 만들어줘 lit`,
  subject: { name: "Rocket", source: "user", specifics: ["a small launcher CLI", "ships one static binary"] },
  inventions: ["both copy lines"],
  product: { name: "Rocket", url: link, assets: [{ path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha }, { path: "stage/assets/02-screenshot.png", role: "screenshot", source: "fetched", sha256: sha }] },
  beats: stageTreatment().beats.concat([{ t0: 16, t1: 20, purpose: "close", onScreen: "the logo settles", motion: "settle", sound: "cadence", layout: "full", hero: "the logo settles", transition: "end" }]).map((b, i, all) => (i === 3 ? { ...b, transition: "cut" } : b)),
  durationSec: 20,
  story: { ...stageTreatment().story },
  protagonist: { ...stageTreatment().protagonist, acts: [...stageTreatment().protagonist.acts, { beat: 4, action: "becomes the logo" }] },
  visualDevices: [{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3, 4] }, { kind: "diagram", role: "support", beats: [1, 2] }, { kind: "gradient", role: "texture", beats: [0, 1, 2, 3, 4] }],
  ...extra
});

test("the shared stage fixture is valid with its story and protagonist", () => {
  assert.deepEqual(validateTreatment(stageTreatment()), { ok: true });
});

test("a stage film needs a story: the expectation, the turn, the shot where it lands, and the payoff", () => {
  const t = stageTreatment();
  delete t.story;
  assert.match(refused(t, "story"), /expect.*turn.*payoff/su);
  for (const key of ["expect", "turn", "payoff"]) {
    const broken = stageTreatment();
    broken.story[key] = "  ";
    refused(broken, `story.${key}`);
  }
  const same = stageTreatment();
  same.story.turn = same.story.expect;
  refused(same, "story.turn");
  const long = stageTreatment();
  long.story.payoff = "One. Two. Three.";
  refused(long, "story.payoff");
  for (const beat of [0, 4, 1.5, "2"]) {
    const off = stageTreatment();
    off.story.beat = beat;
    refused(off, "story.beat");
  }
});

test("a stage film needs a protagonist that acts across the film, including where the turn lands", () => {
  const missing = stageTreatment();
  delete missing.protagonist;
  refused(missing, "protagonist");
  const kind = stageTreatment();
  kind.protagonist.kind = "mood";
  refused(kind, "protagonist.kind");
  const look = stageTreatment();
  look.protagonist.look = "  ";
  refused(look, "protagonist.look");
  const twice = stageTreatment();
  twice.protagonist.acts.push({ beat: 1, action: "again" });
  refused(twice, "protagonist.acts[4].beat");
  const brief = stageTreatment();
  brief.protagonist.acts = [{ beat: 0, action: "falls" }, { beat: 2, action: "joins the water" }];
  assert.equal(validateTreatment(brief).ok, true, "half of a 16 s film is enough");
  const short = stageTreatment();
  short.protagonist.acts = [{ beat: 2, action: "joins the water" }];
  assert.match(refused(short, "protagonist.acts"), /under half/u);
  const turn = stageTreatment();
  turn.protagonist.acts = turn.protagonist.acts.filter((a) => a.beat !== 2);
  assert.match(refused(turn, "protagonist.acts"), /turn lands at shot 3/u);
});

test("the type path takes neither a story nor a protagonist", () => {
  assert.deepEqual(validateTreatment(typeTreatment()), { ok: true });
});

test("a link in the request makes the product required, and it must be that link", () => {
  assert.deepEqual(validateTreatment(productFilm()), { ok: true });
  const t = productFilm();
  delete t.product;
  assert.match(refused(t, "product"), /assets --out <dir> --url/u);
  refused(productFilm({ product: { name: "Rocket", url: "https://github.com/acme/other", assets: [] } }), "product.url");
  assert.deepEqual(validateTreatment(productFilm({ request: `${link}/ 이 프로젝트를 소개하는 영상 만들어줘 lit` })), { ok: true });
});

test("product assets are files under stage/assets with a known role, a source and a hash", () => {
  const product = (asset) => ({ name: "Rocket", url: link, assets: [asset] });
  const good = { path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha };
  refused(productFilm({ product: product({ ...good, path: "stage/../secret.png" }) }), "product.assets[0].path");
  refused(productFilm({ product: product({ ...good, path: "cover/assets/01-logo.png" }) }), "product.assets[0].path");
  refused(productFilm({ product: product({ ...good, role: "banner" }) }), "product.assets[0].role");
  refused(productFilm({ product: product({ ...good, source: "drawn" }) }), "product.assets[0].source");
  refused(productFilm({ product: product({ ...good, sha256: "abc" }) }), "product.assets[0].sha256");
  refused(productFilm({ product: { name: "Rocket", url: link, assets: [] } }), "product.assets");
});

test("an unreachable product is stated, and a real product's subject is never invented", () => {
  assert.deepEqual(validateTreatment(productFilm({ product: { name: "Rocket", url: link, unreachable: "offline" } })), { ok: true });
  refused(productFilm({ product: { name: "Rocket", url: link, unreachable: " " } }), "product.unreachable");
  refused(productFilm({ subject: { name: "Rocket", source: "invented", specifics: ["a", "b"] } }), "subject.source");
});

test("a product may be named without a link, but then it still lists real assets", () => {
  const t = stageTreatment({ product: { name: "빗물 정원", url: "https://garden.example/", assets: [] } });
  refused(t, "product.assets");
});

test("a screen device shows a real screenshot, UI or README image of the product", () => {
  const withScreen = (asset) => productFilm({ visualDevices: [{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3, 4] }, { kind: "screen", role: "support", beats: [1, 2], asset }, { kind: "gradient", role: "texture", beats: [0, 1, 2, 3, 4] }] });
  assert.deepEqual(validateTreatment(withScreen("stage/assets/02-screenshot.png")), { ok: true });
  assert.match(refused(withScreen("stage/assets/01-logo.png"), "visualDevices"), /never draw an invented one/u);
  refused(withScreen("stage/assets/99-missing.png"), "visualDevices");
  refused(stageTreatment({ visualDevices: [{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3] }, { kind: "screen", role: "support", beats: [1], asset: "stage/assets/02-screenshot.png" }] }), "visualDevices");
});

test("the 3D route: a depth3d subject takes depth 3d, and depth 3d needs that subject", () => {
  const solid = (extra = {}) => stageTreatment({ visualDevices: [{ kind: "depth3d", role: "subject", beats: [0, 1, 2, 3] }, { kind: "diagram", role: "support", beats: [1, 2] }, { kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }], ...extra });
  assert.match(refused(solid(), "depth"), /depth to 3d/u);
  assert.deepEqual(validateTreatment(solid({ depth: "3d" })), { ok: true });
  assert.deepEqual(validateTreatment(solid({ depth: "3d", render3d: "three" })), { ok: true });
  refused(stageTreatment({ depth: "3d" }), "depth");
  refused(stageTreatment({ depth: "4d" }), "depth");
  refused(solid({ depth: "3d", render3d: "pixar" }), "render3d");
  refused(solid({ depth: "2d", render3d: "three" }), "depth");
  assert.deepEqual(validateTreatment(stageTreatment({ depth: "2d" })), { ok: true });
});

test("a 3D route is a stage-path route", () => {
  refused(typeTreatment({ depth: "3d" }), "depth");
});
