// The film treatment (`treatment.json` in the run's output directory). Every render validates it
// first, on both paths, and stops with exit 16 naming the first field that fails. The rules keep a
// film from restating the request as its copy, from shipping a copied example, and from claiming a
// drawn subject it does not have. Pure functions; nothing here reads a clock or the network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHouse } from "./house.mjs";
import { LAYOUT_IDS, STYLE_IDS, pickStyle, readStyle, styleBeds, styleColors, styleFamilies } from "./styles.mjs";

export const TREATMENT_EXIT = 16;
export const genres = Object.freeze(["announcement", "brand-mood", "event", "explainer", "motion-graphics", "type-led", "other"]);
export const arcStages = Object.freeze({ announcement: 5, event: 4, explainer: 4, "brand-mood": 4, "motion-graphics": 5, other: 3 });
export const deviceKinds = Object.freeze(["illustration", "diagram", "chart", "icon", "shape", "path", "mask", "depth3d", "screen", "particles", "grid", "gradient", "photo-texture"]);
export const textureKinds = Object.freeze(["grid", "gradient", "particles", "photo-texture"]);
export const soundModes = Object.freeze(["score", "generated", "supplied", "authored", "none"]);
// The genres a rich film's score may take (engine/score.mjs); a style names its default.
export const scoreGenres = Object.freeze(["house", "tech-house", "deep-house", "garage"]);
// How full a film is. Rich is the default; minimal only when the request asks for calm or minimal.
export const registers = Object.freeze(["rich", "minimal"]);
export const soundPalettes = Object.freeze(["glass", "warm", "pulse", "air"]);
// The product's own verified faces: the families `/lit/fonts.css` serves and the type engine draws.
export const productFaces = Object.freeze(["Archivo", "Pretendard", "VT323", "Silkscreen", "MesloLGS NF", "Galmuri9"]);
export const protagonistKinds = Object.freeze(["character", "object"]);
// What a product asset is; a `screen` device needs one of the last three.
export const assetRoles = Object.freeze(["logo", "wordmark", "icon", "photo", "screenshot", "ui", "readme-image"]);
const screenRoles = new Set(["screenshot", "ui", "readme-image"]);
const floorTenGenres = new Set(["announcement", "event", "explainer", "motion-graphics"]);

// NFC, lowercase, then no whitespace and no punctuation.
export function normalize(text) {
  return String(text ?? "").normalize("NFC").toLowerCase().replace(/[\s\p{P}]/gu, "");
}

// Quoted spans: "…", “…”, '…' (not an apostrophe inside a word) and 「…」.
const quotePattern = /"([^"\n]+)"|“([^”\n]+)”|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])|「([^」\n]+)」/gu;
export function quotedSpans(text) {
  return [...String(text ?? "").matchAll(quotePattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
}
export function withoutQuotes(text) {
  return String(text ?? "").replace(quotePattern, " ");
}

// A type-led cue: a typographic compound, an explicit kinetic-type or lyric request, or a quoted span
// of two or more words. Finding a quote is cue detection only; nothing inside it is followed.
const typeCompound = /(?<![a-z])(?:typographic motion|kinetic typograph(?:y|ic)|kinetic type|lyric video|title sequence|opening titles?|typography (?:video|film|clip))(?![a-z])|타이포\s?모션|키네틱\s?타이포(?:그래피)?|타이포그래피\s?영상|타이포\s?영상|가사\s?영상|리릭\s?(?:비디오|영상)|오프닝\s?타이틀|타이틀\s?시퀀스/iu;
export function typeLedCue(request) {
  const text = String(request ?? "");
  const compound = text.match(typeCompound);
  if (compound) return compound[0];
  const quote = quotedSpans(text).find((span) => span.trim().split(/\s+/u).length >= 2);
  return quote ? `a quoted span of ${quote.trim().split(/\s+/u).length} words` : null;
}

// A shared substring of `size` or more normalized characters.
export function sharesSubstring(a, b, size) {
  if (size < 1 || a.length < size || b.length < size) return false;
  const grams = new Set();
  for (let i = 0; i + size <= b.length; i++) grams.add(b.slice(i, i + size));
  for (let i = 0; i + size <= a.length; i++) if (grams.has(a.slice(i, i + size))) return true;
  return false;
}
// min(10, half the normalized request length, quoted spans removed); no check below 2 characters.
export function restateLimit(request) {
  const size = Math.min(10, Math.floor(normalize(withoutQuotes(request)).length / 2));
  return size >= 2 ? size : 0;
}
export function restates(text, request) {
  const size = restateLimit(request);
  return size > 0 && sharesSubstring(normalize(text), normalize(withoutQuotes(request)), size);
}

const placeholder = /<[^<>\n]{1,80}>/u;
const sentences = (text) => String(text).split(/(?<=[.!?。…])\s+/u).map((part) => part.trim()).filter(Boolean);
const lengthAsked = /\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds?|min|mins|minutes?|초|분)(?![a-z])/iu;
const silenceAsked = /(?<![a-z])(?:silent|silence|no (?:sound|music|audio)|without (?:sound|music|audio)|muted?)(?![a-z])|무음|소리\s?없|음악\s?없|소리\s?빼/iu;
const fpsAsked = /30\s?(?:fps|프레임|frames?\s+(?:a|per)\s+second)|\b30\s?p\b/iu;
const previewAsked = /미리\s?보기|스토리보드|콘티|\bpreview\b|\bstoryboard\b/iu;
const calmAsked = /미니멀|잔잔|차분|조용|심플|절제|고요|\bminimal(?:ist|ism)?\b|\bcalm\b|\bquiet\b|\bunderstated\b|\brestrained\b|\bsparse\b|\bserene\b/iu;
const pathTracedAsked = /고퀄|고품질|하이엔드|시네마틱|실사|포토리얼|레이\s?트레이싱|블렌더|\b(?:high[- ]?(?:quality|end)|cinematic|photo-?real(?:istic)?|path[- ]?trac\w*|ray[- ]?trac\w*|blender|cycles)\b/iu;
export const asksCalm = (request) => calmAsked.test(String(request ?? ""));
export const asksPathTraced = (request) => pathTracedAsked.test(String(request ?? ""));
export const registerOf = (t) => t?.register ?? "rich";
export const asks30fps = (request) => fpsAsked.test(String(request ?? ""));
export const asksPreview = (request) => previewAsked.test(String(request ?? ""));
// A link in the request names a real product, repository or site: the film uses its real assets.
const urlInRequest = /\bhttps?:\/\/[^\s"'<>)\]]+/giu;
export const normUrl = (url) => String(url ?? "").trim().replace(/[.,;:!?]+$/u, "").replace(/\/+$/u, "").replace(/\.git$/u, "").toLowerCase();
export const requestUrls = (request) => [...String(request ?? "").matchAll(urlInRequest)].map((match) => normUrl(match[0]));
const keyPattern = /^[A-G][#b]? (?:major|minor)$/u;

class Invalid extends Error {
  constructor(field, detail) { super(detail); this.field = field; }
}
const need = (condition, field, detail) => { if (!condition) throw new Invalid(field, detail); };
const text = (value) => typeof value === "string" && value.trim().length > 0;

// Every string leaf, for the placeholder check.
function stringLeaves(value, at = "", out = []) {
  if (typeof value === "string") out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => stringLeaves(item, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) stringLeaves(item, at ? `${at}.${key}` : key, out);
  return out;
}

// The free-text leaves the copied-example rule compares.
export function freeTextLeaves(t) {
  const leaves = [t?.idea, t?.audience, t?.channel, t?.ambition];
  for (const beat of Array.isArray(t?.beats) ? t.beats : []) leaves.push(beat?.purpose, beat?.onScreen, beat?.motion, beat?.sound, beat?.hero);
  for (const key of ["expect", "turn", "payoff"]) leaves.push(t?.story?.[key]);
  leaves.push(t?.protagonist?.look);
  for (const act of Array.isArray(t?.protagonist?.acts) ? t.protagonist.acts : []) leaves.push(act?.action);
  for (const line of Array.isArray(t?.copy?.lines) ? t.copy.lines : []) leaves.push(line);
  for (const entry of Array.isArray(t?.palette) ? t.palette : []) leaves.push(entry?.role);
  return leaves.filter((leaf) => typeof leaf === "string").map(normalize).filter(Boolean);
}

// Shipped examples: every ```json block in references/treatment.md.
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function shippedExamples(root = skillRoot) {
  const file = path.join(root, "references", "treatment.md");
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)```/gu)].flatMap((match) => {
    try { return [JSON.parse(match[1])]; } catch { return []; }
  });
}
export function copiesExample(t, examples = shippedExamples()) {
  const leaves = freeTextLeaves(t);
  if (leaves.length === 0) return false;
  return examples.some((example) => {
    // A placeholder's angle brackets are markup, so an unbracketed copy still counts as the example.
    const known = new Set(freeTextLeaves(example).map((leaf) => leaf.replace(/[<>]/gu, "")));
    return leaves.filter((leaf) => known.has(leaf)).length * 2 >= leaves.length;
  });
}

function checkBeats(t) {
  need(Array.isArray(t.beats) && t.beats.length > 0, "beats", "beats must be a non-empty array");
  t.beats.forEach((beat, i) => {
    need(beat && typeof beat === "object", "beats", `beat ${i} must be an object`);
    for (const key of ["purpose", "onScreen", "motion", "sound"]) need(text(beat[key]), "beats", `beat ${i} needs ${key}`);
    need(Number.isFinite(beat.t0) && Number.isFinite(beat.t1), "beats", `beat ${i} needs numeric t0 and t1`);
    if (t.path === "stage") checkShot(t, beat, i);
    need(beat.t1 - beat.t0 >= 1.2 - 1e-9, "beats", `beat ${i} lasts ${(beat.t1 - beat.t0).toFixed(2)} s; every beat is at least 1.2 s`);
    if (i > 0) {
      need(beat.t0 >= t.beats[i - 1].t0, "beats", `beat ${i} starts before beat ${i - 1}`);
      need(beat.t0 - t.beats[i - 1].t1 <= 0.25 + 1e-9, "beats", `a gap of ${(beat.t0 - t.beats[i - 1].t1).toFixed(2)} s before beat ${i}; gaps are at most 0.25 s`);
    }
  });
  need(t.beats[0].t0 <= 0.25 + 1e-9, "beats", "the first beat must start within 0.25 s of 0");
  need(t.beats.at(-1).t1 >= t.durationSec - 0.25 - 1e-9, "beats", "the last beat must reach durationSec (gap at most 0.25 s)");
  const stages = t.genre === "type-led" ? (t.copy?.source === "user" ? t.copy.lines.length : 1) : arcStages[t.genre];
  need(t.beats.length >= stages, "beats", `${t.genre} needs at least ${stages} beats (its arc), found ${t.beats.length}`);
}

// A stage shot sits on the style's layout grid: where the drawing leads, where the copy may sit, the
// one move the eye follows, and how the shot hands off to the next.
function checkShot(t, beat, i) {
  const style = readStyle(t.style);
  const at = `beats[${i}]`;
  need(LAYOUT_IDS.includes(beat.layout), "beats", `${at}.layout must be one of ${LAYOUT_IDS.join(", ")}`);
  need(text(beat.hero) && !placeholder.test(beat.hero), "beats", `${at}.hero names the one move the eye follows in this shot`);
  const last = i === t.beats.length - 1;
  if (last) need(beat.transition === "end", "beats", `${at}.transition is end for the last shot`);
  else need(style.transitions.includes(beat.transition), "beats", `${at}.transition: the ${style.id} style hands off with ${style.transitions.join(", ")}`);
  if ("lines" in beat) {
    const count = Array.isArray(t.copy?.lines) ? t.copy.lines.length : 0;
    need(Array.isArray(beat.lines) && beat.lines.every((k) => Number.isInteger(k) && k >= 0 && k < count), "beats", `${at}.lines lists the indices of the copy lines this shot shows`);
    need(!(beat.layout === "full" && beat.lines.length), "beats", `${at}: a full shot has no type zone, so it shows no copy`);
  }
}

// Composition changes with the story: two adjacent shots never share a layout, and a film of four or
// more shots uses at least three, so the eye is not parked on one split for the whole film.
function checkVariety(t) {
  for (let i = 1; i < t.beats.length; i++) {
    need(t.beats[i].layout !== t.beats[i - 1].layout, "beats", `shots ${i} and ${i + 1} both use ${t.beats[i].layout}; adjacent shots change layout`);
  }
  const used = new Set(t.beats.map((beat) => beat.layout));
  need(!(t.beats.length >= 4 && used.size < 3), "beats", `${t.beats.length} shots use only ${[...used].join(" and ")}; a film of four or more shots uses at least three layouts`);
}

// The story: what the viewer expects, the turn they do not, the shot where it lands, and the payoff.
// A genre arc alone is an information order, not a story. Stage films only; on the type path the words are the film.
function checkStory(t) {
  if (t.path !== "stage") return;
  need("story" in t, "story", "missing: { expect, turn, beat, payoff }: what the viewer expects, what happens instead, the shot where it lands, what the ending gives");
  const story = t.story;
  need(story && typeof story === "object" && !Array.isArray(story), "story", "story must be an object { expect, turn, beat, payoff }");
  for (const key of ["expect", "turn", "payoff"]) {
    need(text(story[key]), `story.${key}`, `story.${key} must be a non-empty string`);
    need(sentences(story[key]).length <= 2, `story.${key}`, `story.${key} is at most 2 sentences`);
  }
  need(normalize(story.turn) !== normalize(story.expect), "story.turn", "the turn is what the viewer does not expect; it cannot equal story.expect");
  need(Number.isInteger(story.beat) && story.beat >= 1 && story.beat < t.beats.length, "story.beat", `story.beat is the index of the shot where the turn lands: after the opening, before the end (1-${t.beats.length - 1})`);
}

// The protagonist: one drawn character or hero object that acts across the film.
function checkProtagonist(t) {
  if (t.path !== "stage") return;
  need("protagonist" in t, "protagonist", "missing: { name, kind, look, acts[] }: the character or hero object that acts across the film");
  const p = t.protagonist;
  need(p && typeof p === "object" && !Array.isArray(p), "protagonist", "protagonist must be an object { name, kind, look, acts }");
  need(text(p.name), "protagonist.name", "protagonist.name must name it");
  need(protagonistKinds.includes(p.kind), "protagonist.kind", `protagonist.kind must be ${protagonistKinds.join(" or ")}`);
  need(text(p.look), "protagonist.look", "protagonist.look says what it looks like on screen: shape, material, colour role, scale in the frame");
  need(Array.isArray(p.acts) && p.acts.length > 0, "protagonist.acts", "list what it does, shot by shot: [{ beat, action }]");
  const seen = new Set();
  p.acts.forEach((act, i) => {
    const at = `protagonist.acts[${i}]`;
    need(Number.isInteger(act?.beat) && act.beat >= 0 && act.beat < t.beats.length, `${at}.beat`, `${at}.beat must be a beat index`);
    need(!seen.has(act.beat), `${at}.beat`, `${at}: one act per shot`);
    seen.add(act.beat);
    need(text(act.action), `${at}.action`, `${at}.action says what it does in this shot, as a viewer would see it`);
  });
  const covered = beatSeconds(t, [...seen]);
  need(covered >= 0.5 * t.durationSec - 1e-9, "protagonist.acts", `it acts for ${covered.toFixed(1)} s, under half the film; it carries the film, not one shot`);
  need(seen.has(t.story.beat), "protagonist.acts", `the turn lands at shot ${t.story.beat + 1}, and the protagonist has no act there`);
}

// A named product, repository or site: its real logo, images, UI and words, never invented ones. The
// request's link makes it required; `render.mjs assets` fetches what it can reach.
function checkProduct(t) {
  const urls = requestUrls(t.request);
  if (!("product" in t)) {
    need(urls.length === 0, "product", `missing: the request links ${urls[0]}; fetch its real assets with render.mjs assets --out <dir> --url <link> and list them`);
    return;
  }
  const p = t.product;
  need(p && typeof p === "object" && !Array.isArray(p), "product", "product must be an object { name, url, assets }");
  need(text(p.name), "product.name", "product.name must name the product");
  need(urls.length === 0 || urls.includes(normUrl(p.url)), "product.url", `product.url must be the link the request gives (${urls.join(", ")})`);
  if ("unreachable" in p) {
    need(text(p.unreachable), "product.unreachable", "say what could not be reached and why");
    return;
  }
  need(Array.isArray(p.assets) && p.assets.length > 0, "product.assets", "list the real assets the film uses: [{ path, role, source, sha256 }]; when none can be reached set unreachable and ask the user");
  p.assets.forEach((asset, i) => {
    const at = `product.assets[${i}]`;
    need(typeof asset?.path === "string" && asset.path.startsWith("stage/assets/") && !asset.path.split("/").includes(".."), `${at}.path`, `${at}.path must be a file under stage/assets/, relative to the output directory`);
    need(assetRoles.includes(asset.role), `${at}.role`, `${at}.role must be one of ${assetRoles.join(", ")}`);
    need(["fetched", "user"].includes(asset.source), `${at}.source`, `${at}.source must be fetched (by render.mjs assets) or user (supplied)`);
    need(/^[0-9a-f]{64}$/u.test(asset.sha256 ?? ""), `${at}.sha256`, `${at}.sha256 must be the file's SHA-256`);
  });
  need(t.subject?.source !== "invented", "subject.source", "the product is real: the subject is the product (source user), its specifics from its own words");
}

// The register is the request's, like the format: rich unless it asks for a calm, quiet or minimal film.
// A stage-path field; on the type path the words are the film and there is no register to choose.
function checkRegister(t) {
  if (t.path !== "stage") {
    need(!("register" in t), "register", "register belongs to a stage film; the type path takes none");
    return;
  }
  const register = registerOf(t);
  need(registers.includes(register), "register", "rich (the default) or minimal");
  const calm = asksCalm(t.request);
  need(register !== "minimal" || calm, "register", "minimal only when the request asks for a calm, quiet or minimal film; the default is rich (references/studio.md, Register)");
  need(register !== "rich" || !calm, "register", "the request asks for a calm or minimal film: register minimal");
}

// The 3D route: a depth3d subject is drawn with the pinned three.js on the GPU rung (references/depth.md).
function checkDepth(t) {
  need(!("depth" in t) || ["2d", "3d"].includes(t.depth), "depth", "depth is 2d (the default) or 3d");
  need(!("render3d" in t) || ["three", "blender"].includes(t.render3d), "render3d", "render3d is three (the GPU rung, the default) or blender (the offline Cycles rung)");
  if (t.path !== "stage") {
    need(t.depth !== "3d", "depth", "3d is a stage-path route");
    return;
  }
  const solid = t.visualDevices.some((device) => device.kind === "depth3d" && device.role === "subject");
  need(!solid || t.depth === "3d", "depth", "the subject is a depth3d device: set depth to 3d, so the film takes the 3D route");
  need(t.depth !== "3d" || solid, "depth", "3d needs the subject drawn as a depth3d device (role subject)");
  need(!("render3d" in t) || t.depth === "3d", "depth", "render3d belongs to a depth 3d film");
}

function checkStyle(t, house) {
  need("style" in t, "style", `missing: one of ${STYLE_IDS.join(", ")}`);
  need(STYLE_IDS.includes(t.style), "style", `must be one of ${STYLE_IDS.join(", ")}`);
  const pick = pickStyle({ request: t.request, copy: Array.isArray(t.copy?.lines) ? t.copy.lines : [], path: t.path, house, genre: t.genre });
  need(t.style === pick.id, "style", `${pick.reason}; this film takes the ${pick.id} style`);
}

function beatSeconds(t, indices) {
  const covered = new Set(indices);
  return [...covered].reduce((sum, i) => sum + (t.beats[i].t1 - t.beats[i].t0), 0);
}

// Returns { ok: true } or { ok: false, field, detail }.
export function validateTreatment(t, { examples, house = null } = {}) {
  try {
    need(t && typeof t === "object" && !Array.isArray(t), "treatment", "treatment.json must hold a JSON object");
    const leaf = stringLeaves(t).find(([, value]) => placeholder.test(value));
    need(!leaf, leaf?.[0].split(/[.[]/u)[0] || "treatment", `${leaf?.[0]} still holds a placeholder (${leaf?.[1]})`);
    need(text(t.request), "request", "request must be the user's words, verbatim");
    need(genres.includes(t.genre), "genre", `genre must be one of ${genres.join(", ")}`);
    need(["type", "stage"].includes(t.path), "path", "path must be type or stage");
    need(text(t.pathReason), "pathReason", "pathReason must say why this path fits");
    checkStyle(t, house);
    need(text(t.idea), "idea", "idea must be one sentence");
    need(sentences(t.idea).length === 1, "idea", "idea must be exactly one sentence");
    need(!restates(t.idea, t.request), "idea", "idea restates the request; say the film's own idea");
    need(text(t.audience), "audience", "audience must say who watches");
    need(text(t.channel), "channel", "channel must say where it plays");
    need(["16:9", "9:16"].includes(t.format), "format", "format must be 16:9 or 9:16");
    need(text(t.formatReason), "formatReason", "formatReason must tie the format to the channel");
    need(Number.isFinite(t.durationSec) && t.durationSec >= 4 && t.durationSec <= 90, "durationSec", "durationSec must be 4-90");
    if (floorTenGenres.has(t.genre) && !lengthAsked.test(t.request)) need(t.durationSec >= 10, "durationSec", `a ${t.genre} film runs at least 10 s unless the user asked for a length`);
    need(t.copy && typeof t.copy === "object", "copy", "copy must be { source, lines[] }");
    need(["user", "invented"].includes(t.copy.source), "copy", "copy.source must be user or invented");
    need(Array.isArray(t.copy.lines) && t.copy.lines.length > 0 && t.copy.lines.every(text), "copy", "copy.lines must be non-empty strings");
    checkBeats(t);
    if (t.path === "stage") checkVariety(t);
    need(t.subject && typeof t.subject === "object", "subject", "subject must be { name, source, specifics[] }");
    need(text(t.subject.name), "subject", "subject.name is required");
    need(["user", "invented"].includes(t.subject.source), "subject", "subject.source must be user or invented");
    need(Array.isArray(t.subject.specifics) && t.subject.specifics.filter(text).length >= 2, "subject", "subject.specifics needs at least 2 concrete specifics");
    if (t.subject.source === "user") need(normalize(t.request).includes(normalize(t.subject.name)), "subject", "subject.source is user, but the request does not name it; mark it invented");
    checkRegister(t);
    checkStory(t);
    checkProtagonist(t);
    checkProduct(t);
    need(Array.isArray(t.visualDevices), "visualDevices", "visualDevices must be an array");
    t.visualDevices.forEach((device, i) => {
      need(device && deviceKinds.includes(device.kind), "visualDevices", `device ${i}: kind must be one of ${deviceKinds.join(", ")}`);
      need(["subject", "support", "texture"].includes(device.role), "visualDevices", `device ${i}: role must be subject, support or texture`);
      need(!textureKinds.includes(device.kind) || device.role === "texture", "visualDevices", `device ${i}: ${device.kind} is always a texture`);
      need(Array.isArray(device.beats) && device.beats.length > 0 && device.beats.every((b) => Number.isInteger(b) && b >= 0 && b < t.beats.length), "visualDevices", `device ${i}: beats must list beat indices`);
      if (device.kind === "screen") {
        const real = (Array.isArray(t.product?.assets) ? t.product.assets : []).find((asset) => asset.path === device.asset);
        need(real && screenRoles.has(real.role), "visualDevices", `device ${i}: a product screen shows the product's real screenshot, UI or README image: name one listed in product.assets; never draw an invented one`);
      }
    });
    checkDepth(t);
    if (t.path === "stage") {
      const subjects = t.visualDevices.filter((device) => device.role === "subject");
      need(subjects.length > 0, "visualDevices", "the stage path needs at least one role: subject device, a drawn depiction of what the film is about");
      need(subjects.some((device) => beatSeconds(t, device.beats) >= 0.5 * t.durationSec - 1e-9), "visualDevices", "a subject device must be on screen for at least half of durationSec");
      const counting = new Set(t.visualDevices.map((device) => device.kind).filter((kind) => !textureKinds.includes(kind)));
      need(counting.size >= 2, "visualDevices", "the stage path needs at least 2 distinct non-texture device kinds");
    }
    need(t.path !== "type" || t.format === "16:9", "path", "a 9:16 film always takes the stage path");
    need(t.path !== "type" || t.copy.source === "user" || typeLedCue(t.request), "path", "the type path needs the user's own words or a type-led cue in the request");
    need(t.typePlan && typeof t.typePlan === "object", "typePlan", "typePlan must be { faces[], hierarchy, maxWordsOnScreen }");
    need(Array.isArray(t.typePlan.faces) && t.typePlan.faces.length > 0 && t.typePlan.faces.every((face) => productFaces.includes(face)), "typePlan", `typePlan.faces must come from ${productFaces.join(", ")}`);
    if (t.path === "stage") {
      const families = styleFamilies(readStyle(t.style));
      const off = t.typePlan.faces.find((face) => !families.has(face));
      need(off === undefined, "typePlan", `${off} is not a face of the ${t.style} style (${[...families].join(", ")})`);
    }
    need(text(t.typePlan.hierarchy), "typePlan", "typePlan.hierarchy is required");
    need(Number.isInteger(t.typePlan.maxWordsOnScreen) && t.typePlan.maxWordsOnScreen >= 1, "typePlan", "typePlan.maxWordsOnScreen must be a positive integer");
    need(Array.isArray(t.palette) && t.palette.length >= 3 && t.palette.length <= (t.path === "stage" && registerOf(t) === "rich" ? 14 : 6), "palette", `palette needs 3-${t.path === "stage" && registerOf(t) === "rich" ? 14 : 6} colours`);
    t.palette.forEach((entry, i) => need(entry && /^#[0-9a-f]{6}$/iu.test(entry.hex ?? "") && text(entry.role), "palette", `palette ${i} must be { hex: "#rrggbb", role }`));
    if (t.path === "stage") {
      const rich = registerOf(t) === "rich";
      const allowed = new Set(styleColors(readStyle(t.style), { rich }));
      const off = t.palette.find((entry) => !allowed.has(entry.hex.toLowerCase()));
      need(off === undefined, "palette", `${off?.hex} is not a colour of the ${t.style} style${rich ? " or one of its role accents" : " (a minimal film keeps to the core palette)"}; the stage palette comes from the style`);
    }
    need(t.sound && soundModes.includes(t.sound.mode), "sound", `sound.mode must be one of ${soundModes.join(", ")}`);
    need(text(t.sound.plan), "sound", "sound.plan is required");
    need(!(t.sound.mode === "generated" && t.path === "stage" && registerOf(t) === "rich"), "sound", "a rich film scores its own music (sound.mode score); the style's preset beds are for minimal films (references/sound.md)");
    need(!("genre" in t.sound) || scoreGenres.includes(t.sound.genre), "sound", `sound.genre must be one of ${scoreGenres.join(", ")}`);
    if (t.sound.mode === "generated") {
      need(soundPalettes.includes(t.sound.palette), "sound", `sound.palette must be one of ${soundPalettes.join(", ")}`);
      need(Number.isFinite(t.sound.tempo) && t.sound.tempo >= 60 && t.sound.tempo <= 180, "sound", "sound.tempo must be 60-180 BPM");
      need(keyPattern.test(t.sound.key ?? ""), "sound", "sound.key must look like \"D minor\" or \"F# major\"");
      const beds = styleBeds(readStyle(t.style));
      const same = (bed) => bed.palette === t.sound.palette && bed.key.toLowerCase() === t.sound.key.toLowerCase() && bed.tempo === t.sound.tempo;
      need(beds.some(same), "sound", `pick one of the ${t.style} style's beds: ${beds.map((bed) => `${bed.palette} ${bed.key} ${bed.tempo} BPM`).join("; ")}`);
    }
    if (t.sound.mode === "supplied" || t.sound.mode === "authored") need(text(t.sound.file), "sound", `sound.file is required for ${t.sound.mode} sound`);
    if (t.sound.mode === "none") need(silenceAsked.test(t.request) || t.sound.mutedByDesign === true, "sound", "silence needs a user request for it, or sound.mutedByDesign for a channel that plays muted");
    if (t.copy.source === "user") {
      const request = normalize(t.request);
      const missing = t.copy.lines.find((line) => !request.includes(normalize(line)));
      need(missing === undefined, "copy", `copy.source is user, but "${missing}" is not in the request`);
    } else {
      const restated = t.copy.lines.find((line) => restates(line, t.request));
      need(restated === undefined, "copy", `invented copy restates the request: "${restated}"`);
    }
    const invented = t.copy.source === "invented" || t.subject.source === "invented";
    if (invented) {
      need(Array.isArray(t.inventions) && t.inventions.filter(text).length > 0, "inventions", "inventions must list every invented subject, line and fact");
      if (t.subject.source === "invented") need(t.inventions.some((entry) => text(entry) && normalize(entry).includes(normalize(t.subject.name))), "inventions", "inventions must include subject.name");
    }
    need(text(t.ambition) && sentences(t.ambition).length <= 2, "ambition", "ambition must be 1-2 sentences in craft terms");
    if (t.seed !== undefined) need(Number.isSafeInteger(t.seed), "seed", "seed must be an integer");
    if (t.fps !== undefined) need(t.fps === 60 || t.fps === 30, "fps", "fps must be 60 or 30");
    need(t.fps !== 30 || asks30fps(t.request), "fps", "fps is 60; 30 only when the request asks for 30 fps");
    if (t.preview !== undefined) need(typeof t.preview === "boolean", "preview", "preview must be true or false");
    need(t.preview !== true || asksPreview(t.request), "preview", "preview is true only when the request asks for a preview or storyboard first");
    need(!copiesExample(t, examples), "copiedExample", "half or more of the free-text fields equal a shipped example; write this film's own treatment");
    return { ok: true };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, field: error.field, detail: error.message };
    throw error;
  }
}

export function frameSize(t) {
  return t.format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

// Read and validate `<out>/treatment.json`; throws an error carrying exitCode 16 and the field.
export function loadTreatment(out) {
  const file = path.join(out, "treatment.json");
  const fail = (field, detail) => {
    const error = new Error(`BLOCKED_TREATMENT_INVALID (16): field ${field}: ${detail}`);
    error.exitCode = TREATMENT_EXIT; error.field = field;
    return error;
  };
  if (!existsSync(file)) throw fail("treatment", `no treatment.json in ${out}; write it first (references/treatment.md)`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw fail("treatment", `treatment.json is not JSON (${error.message})`); }
  if (parsed?.mode === "cover") throw fail("mode", "this is a cover treatment; render it with `render.mjs cover --out <dir>` (references/cover.md)");
  const result = validateTreatment(parsed, { house: readHouse(out) });
  if (!result.ok) throw fail(result.field, result.detail);
  return { treatment: parsed, file };
}

// Section 9 "never downgrade to pass": compare the final treatment with the first valid one.
export function downgrades(first, last) {
  if (!first || !last) return [];
  const found = [];
  if (last.durationSec < first.durationSec * 0.8 - 1e-9) found.push(`durationSec dropped from ${first.durationSec} to ${last.durationSec}`);
  const subjectBeats = (t) => new Set((t.visualDevices ?? []).filter((d) => d.role === "subject").flatMap((d) => d.beats)).size;
  if (subjectBeats(last) < subjectBeats(first)) found.push(`subject beats fell from ${subjectBeats(first)} to ${subjectBeats(last)}`);
  if (first.sound?.mode !== "none" && last.sound?.mode === "none" && !silenceAsked.test(last.request ?? "")) found.push("sound changed to none without a user request");
  if (first.path === "stage" && last.path === "type") found.push("path changed from stage to type");
  return found;
}

// The first valid treatment is kept so the done check can tell a downgrade from a fix.
export function keepFirstTreatment(out, treatment) {
  const first = path.join(out, ".run", "treatment-first.json");
  mkdirSync(path.dirname(first), { recursive: true });
  if (!existsSync(first)) writeFileSync(first, JSON.stringify(treatment, null, 2) + "\n");
}
