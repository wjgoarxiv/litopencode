// The film treatment (`treatment.json` in the run's output directory). Every render validates it
// first, on both paths, and stops with exit 16 naming the first field that fails. The rules keep a
// film from restating the request as its copy, from shipping a copied example, and from claiming a
// drawn subject it does not have. Pure functions; nothing here reads a clock or the network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TREATMENT_EXIT = 16;
export const genres = Object.freeze(["announcement", "brand-mood", "event", "explainer", "motion-graphics", "type-led", "other"]);
export const arcStages = Object.freeze({ announcement: 5, event: 4, explainer: 4, "brand-mood": 4, "motion-graphics": 5, other: 3 });
export const deviceKinds = Object.freeze(["illustration", "diagram", "chart", "icon", "shape", "path", "mask", "depth3d", "particles", "grid", "gradient", "photo-texture"]);
export const textureKinds = Object.freeze(["grid", "gradient", "particles", "photo-texture"]);
export const soundModes = Object.freeze(["generated", "supplied", "authored", "none"]);
export const soundPalettes = Object.freeze(["glass", "warm", "pulse", "air"]);
// The product's own verified faces: the families `/lit/fonts.css` serves and the type engine draws.
export const productFaces = Object.freeze(["Archivo", "LitOpenCode Sans", "VT323", "Silkscreen", "MesloLGS NF", "Galmuri9"]);
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
  for (const beat of Array.isArray(t?.beats) ? t.beats : []) leaves.push(beat?.purpose, beat?.onScreen, beat?.motion, beat?.sound);
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

function beatSeconds(t, indices) {
  const covered = new Set(indices);
  return [...covered].reduce((sum, i) => sum + (t.beats[i].t1 - t.beats[i].t0), 0);
}

// Returns { ok: true } or { ok: false, field, detail }.
export function validateTreatment(t, { examples } = {}) {
  try {
    need(t && typeof t === "object" && !Array.isArray(t), "treatment", "treatment.json must hold a JSON object");
    const leaf = stringLeaves(t).find(([, value]) => placeholder.test(value));
    need(!leaf, leaf?.[0].split(/[.[]/u)[0] || "treatment", `${leaf?.[0]} still holds a placeholder (${leaf?.[1]})`);
    need(text(t.request), "request", "request must be the user's words, verbatim");
    need(genres.includes(t.genre), "genre", `genre must be one of ${genres.join(", ")}`);
    need(["type", "stage"].includes(t.path), "path", "path must be type or stage");
    need(text(t.pathReason), "pathReason", "pathReason must say why this path fits");
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
    need(t.subject && typeof t.subject === "object", "subject", "subject must be { name, source, specifics[] }");
    need(text(t.subject.name), "subject", "subject.name is required");
    need(["user", "invented"].includes(t.subject.source), "subject", "subject.source must be user or invented");
    need(Array.isArray(t.subject.specifics) && t.subject.specifics.filter(text).length >= 2, "subject", "subject.specifics needs at least 2 concrete specifics");
    if (t.subject.source === "user") need(normalize(t.request).includes(normalize(t.subject.name)), "subject", "subject.source is user, but the request does not name it; mark it invented");
    need(Array.isArray(t.visualDevices), "visualDevices", "visualDevices must be an array");
    t.visualDevices.forEach((device, i) => {
      need(device && deviceKinds.includes(device.kind), "visualDevices", `device ${i}: kind must be one of ${deviceKinds.join(", ")}`);
      need(["subject", "support", "texture"].includes(device.role), "visualDevices", `device ${i}: role must be subject, support or texture`);
      need(!textureKinds.includes(device.kind) || device.role === "texture", "visualDevices", `device ${i}: ${device.kind} is always a texture`);
      need(Array.isArray(device.beats) && device.beats.length > 0 && device.beats.every((b) => Number.isInteger(b) && b >= 0 && b < t.beats.length), "visualDevices", `device ${i}: beats must list beat indices`);
    });
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
    need(text(t.typePlan.hierarchy), "typePlan", "typePlan.hierarchy is required");
    need(Number.isInteger(t.typePlan.maxWordsOnScreen) && t.typePlan.maxWordsOnScreen >= 1, "typePlan", "typePlan.maxWordsOnScreen must be a positive integer");
    need(Array.isArray(t.palette) && t.palette.length >= 3 && t.palette.length <= 6, "palette", "palette needs 3-6 colours");
    t.palette.forEach((entry, i) => need(entry && /^#[0-9a-f]{6}$/iu.test(entry.hex ?? "") && text(entry.role), "palette", `palette ${i} must be { hex: "#rrggbb", role }`));
    need(t.sound && soundModes.includes(t.sound.mode), "sound", `sound.mode must be one of ${soundModes.join(", ")}`);
    need(text(t.sound.plan), "sound", "sound.plan is required");
    if (t.sound.mode === "generated") {
      need(soundPalettes.includes(t.sound.palette), "sound", `sound.palette must be one of ${soundPalettes.join(", ")}`);
      need(Number.isFinite(t.sound.tempo) && t.sound.tempo >= 60 && t.sound.tempo <= 180, "sound", "sound.tempo must be 60-180 BPM");
      need(keyPattern.test(t.sound.key ?? ""), "sound", "sound.key must look like \"D minor\" or \"F# major\"");
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
  const result = validateTreatment(parsed);
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
