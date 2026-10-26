// The cover treatment: `treatment.json` with `"mode": "cover"`, validated by every cover render
// before anything starts (exit 16 names the first field that fails). A cover is not a film, so this
// is not the film treatment with fields removed: it has no beats, no arc, no copy lines, no ending
// and no sound. It names one recipe, the one rule copied many times, the three speed layers, the
// brand word set once (plus at most one motto that the user wrote or the project already uses), the
// aspect and loop, and the title box the contrast and size gates measure. Its text is inert data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { COVER, EXIT } from "../constants.mjs";
import { normUrl, normalize, requestUrls, restates, TREATMENT_EXIT } from "../treatment.mjs";

export const RECIPES = Object.freeze(["hero-3d", "painted-light", "weight-tide", "orbit-loop", "own"]);
export const LAYERS = Object.freeze(["slow", "mid", "beat"]);

class Invalid extends Error {
  constructor(field, detail) { super(detail); this.field = field; }
}
const need = (condition, field, detail) => { if (!condition) throw new Invalid(field, detail); };
const placeholder = /<[^<>\n]{1,80}>|^\s*(?:todo|tbd|xxx|\.\.\.|…)\s*$/iu;
const sentences = (text) => String(text).split(/(?<=[.!?。…])\s+/u).map((part) => part.trim()).filter(Boolean).length;
const words = (text) => String(text).trim().split(/\s+/u).filter(Boolean).length;

function text(t, key, { maxSentences } = {}) {
  const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), t);
  need(typeof value === "string" && value.trim().length > 0, key, value === undefined ? "missing" : "must be a non-empty string");
  need(!placeholder.test(value), key, `still holds a placeholder (${value})`);
  if (maxSentences) need(sentences(value) <= maxSentences, key, `at most ${maxSentences} sentence(s)`);
  return value;
}

// A link in the request names the product: the cover is built from its real logo, images and words,
// fetched by `render.mjs assets --cover` before the treatment, never from the name alone.
function checkProduct(t) {
  const urls = requestUrls(t.request);
  if (!("product" in t)) {
    need(!urls.length, "product", `missing: the request links ${urls[0]}; fetch its real assets first with render.mjs assets --out <dir> --url <link> --cover, look at them, and set product { name, url } (references/cover.md, Named products)`);
    return;
  }
  need(t.product && typeof t.product === "object" && !Array.isArray(t.product), "product", "must be an object { name, url }");
  text(t, "product.name");
  if (urls.length) need(urls.includes(normUrl(t.product.url)), "product.url", `must be the link the request gives (${urls.join(", ")})`);
  if ("unreachable" in t.product) text(t, "product.unreachable");
}

/** Validate a cover treatment. Returns { ok: true, cover } with the derived sizes, or { ok: false, field, detail }. */
export function validateCoverTreatment(t) {
  try {
    need(t && typeof t === "object" && !Array.isArray(t), "treatment", "treatment.json must hold a JSON object");
    need(t.mode === "cover", "mode", "must be cover for a cover render");
    text(t, "request");
    text(t, "idea", { maxSentences: 1 });
    need(!restates(t.idea, t.request), "idea", "the idea restates the request; say what the loop does");
    need(RECIPES.includes(t.recipe), "recipe", `must be one of ${RECIPES.join(", ")} (references/cover.md)`);
    text(t, "recipeReason", { maxSentences: 2 });
    text(t, "hero", { maxSentences: 2 });
    text(t, "beat", { maxSentences: 2 });
    text(t, "brandWord");
    checkProduct(t);
    need(words(t.brandWord) <= 3, "brandWord", "is the name, set once: at most three words");
    if ("motto" in t) {
      need(t.motto && typeof t.motto === "object", "motto", "must be { text, source: user | project, from? }");
      text(t, "motto.text");
      need(words(t.motto.text) <= 6, "motto.text", "at most six words");
      need(["user", "project"].includes(t.motto.source), "motto.source", "must be user (in the request) or project (the project's own line, with from)");
      if (t.motto.source === "user") need(normalize(t.request).includes(normalize(t.motto.text)), "motto.text", "a user motto appears in the request; a cover never invents a tagline");
      else text(t, "motto.from");
    }
    for (const key of ["copy", "beats", "lines"]) need(!(key in t), key, "a cover has no copy lines and no beats: the brand word is set once and never swapped (references/cover.md)");
    need(!("sound" in t) || t.sound === "none", "sound", "a cover is silent: leave sound out or set it to none");
    need(Object.hasOwn(COVER.aspects, t.aspect), "aspect", `must be ${Object.keys(COVER.aspects).join(" or ")}`);
    need(typeof t.loopSec === "number" && t.loopSec >= COVER.minSec && t.loopSec <= COVER.maxSec, "loopSec", `must be ${COVER.minSec}-${COVER.maxSec} seconds`);
    need(COVER.fps.includes(t.fps), "fps", `must be one of ${COVER.fps.join(", ")}`);
    need(t.layers && typeof t.layers === "object", "layers", "missing: name what moves on the slow, mid and beat layers");
    for (const layer of LAYERS) text(t, `layers.${layer}`, { maxSentences: 2 });
    need(t.system && typeof t.system === "object", "system", "missing: the one rule, what it is copied onto, and where the offsets come from");
    for (const part of ["rule", "copies", "offset"]) text(t, `system.${part}`, { maxSentences: 2 });
    const box = t.title?.box;
    need(t.title && typeof t.title === "object", "title", "missing: { box: [x, y, w, h] as fractions of the cover, kind: live or painted }");
    need(Array.isArray(box) && box.length === 4 && box.every((v) => typeof v === "number" && v >= 0 && v <= 1), "title.box", "must be [x, y, w, h], each a fraction of the cover");
    need(box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1 + 1e-9 && box[1] + box[3] <= 1 + 1e-9, "title.box", "must lie inside the cover");
    need(["live", "painted"].includes(t.title.kind), "title.kind", "must be live (set as text) or painted (part of the base art)");
    if ("palette" in t) {
      need(Array.isArray(t.palette) && t.palette.length >= 2 && t.palette.length <= 6, "palette", "2-6 { color, role } entries");
      t.palette.forEach((entry, i) => {
        need(/^#[0-9a-f]{6}$/iu.test(entry?.color ?? ""), `palette[${i}].color`, "must be #rrggbb");
        need(typeof entry?.role === "string" && entry.role.trim(), `palette[${i}].role`, "must say the colour's job");
      });
    }
    if ("encode" in t) {
      need(t.encode && typeof t.encode === "object", "encode", "must be { q, edgeQ, edgeFrames }");
      for (const [key, lo, hi] of [["q", 50, 100], ["edgeQ", 50, 100], ["edgeFrames", 0, 60]]) {
        if (key in t.encode) need(Number.isInteger(t.encode[key]) && t.encode[key] >= lo && t.encode[key] <= hi, `encode.${key}`, `an integer ${lo}-${hi}`);
      }
    }
    if ("seed" in t) need(Number.isSafeInteger(t.seed), "seed", "must be an integer");
    text(t, "ambition", { maxSentences: 2 });
    const { page, size } = COVER.aspects[t.aspect];
    return {
      ok: true,
      cover: { ...t, page: [...page], size: [...size], frames: Math.round(t.loopSec * t.fps), encode: { ...COVER.encode, ...(t.encode ?? {}) }, seed: Number.isSafeInteger(t.seed) ? t.seed >>> 0 : 20261020 }
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, field: error.field, detail: error.message };
    throw error;
  }
}

/** True when `<out>/treatment.json` is readable JSON with mode cover (validity aside). */
export function isCoverRun(out) {
  try { return JSON.parse(readFileSync(path.join(out, "treatment.json"), "utf8"))?.mode === "cover"; } catch { return false; }
}

/** Read and validate `<out>/treatment.json` as a cover; throws exit 16 naming the field. Keeps the first valid one. */
export function loadCoverTreatment(out) {
  const file = path.join(out, "treatment.json");
  const fail = (field, detail) => Object.assign(new Error(`BLOCKED_TREATMENT_INVALID (16): field ${field}: ${detail}`), { exitCode: TREATMENT_EXIT, field });
  if (!existsSync(file)) throw fail("treatment", `no treatment.json in ${out}; write the cover treatment first (references/cover.md)`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw fail("treatment", `treatment.json is not JSON (${error.message})`); }
  if (parsed?.mode !== "cover") throw fail("mode", "this treatment is a film; render it with `render.mjs stage` or `render.mjs film` (references/treatment.md). A cover sets mode: cover");
  const result = validateCoverTreatment(parsed);
  if (!result.ok) throw fail(result.field, result.detail);
  const product = result.cover.product;
  if (product?.unreachable) throw Object.assign(new Error(`BLOCKED_ASSET_MISSING (${EXIT.BLOCKED_ASSET_MISSING}): ${product.name}'s real assets could not be reached (${product.unreachable}); ask the user for its logo or README images, put them in ${path.join(out, "cover", "assets")} and list them in assets.json with source user`), { exitCode: EXIT.BLOCKED_ASSET_MISSING });
  if (product) {
    const file = path.join(out, "product.json");
    if (!existsSync(file)) throw fail("product", `no ${file}: run render.mjs assets --out ${out} --url ${product.url} --cover first`);
    let fetched = [];
    try { fetched = JSON.parse(readFileSync(file, "utf8"))?.product?.assets ?? []; } catch (error) { throw fail("product", `${file} is not valid JSON (${error.message}); run render.mjs assets --out ${out} --url ${product.url} --cover again`); }
    const astray = fetched.filter((asset) => !String(asset?.path ?? "").startsWith("cover/assets/"));
    if (astray.length) throw fail("product", `${astray[0].path} sits outside cover/assets/, where the cover page cannot load it; run render.mjs assets --out ${out} --url ${product.url} --cover again`);
  }
  const first = path.join(out, ".run", "treatment-first.json");
  mkdirSync(path.dirname(first), { recursive: true });
  if (!existsSync(first)) writeFileSync(first, JSON.stringify(parsed, null, 2) + "\n");
  return result.cover;
}
