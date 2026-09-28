// Pure text helpers shared by the timeline builder, the pre-flight gate and the tests.
// Nothing here reads a clock or an unseeded random source.
import { limits, presetKeywordTable, presets } from "./constants.mjs";

// MO-SH-01: FNV-1a 32-bit over UTF-8 bytes.
export function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(input))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash >>> 0;
}

export function passSeed(runSeed, sceneId, shotIndex, pass) {
  return fnv1a32(`${runSeed}:${sceneId}:${shotIndex}:${pass}`);
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// MO-A-34: typographic punctuation over the brief's own text, and back for a typed-input voice.
export function smart(text) {
  return String(text)
    .replace(/\.\.\./gu, "…")
    .replace(/(^|[\s([{—–-])'(?=(?:cause|til|em|round|n|tis|twas|\d0s)\b)/giu, "$1’")
    .replace(/(^|[\s([{—–-])'/gu, "$1‘")
    .replace(/'/gu, "’")
    .replace(/(^|[\s([{—–-])"/gu, "$1“")
    .replace(/"/gu, "”");
}

export function plain(text) {
  return String(text).replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/…/gu, "...");
}

const hangulChar = /[ᄀ-ᇿ㄰-㆏가-힣]/u;
const hangulSyllable = /[가-힣]/gu;
const letterChar = /\p{L}/u;

export function charScript(char) {
  if (hangulChar.test(char)) return "hangul";
  if (letterChar.test(char)) return "latin";
  return "neutral";
}

// MO-FT-04: digits, spaces and punctuation join the adjacent script run; between two different
// runs they fall back to the run on their left.
export function scriptRuns(text) {
  const chars = Array.from(String(text));
  const kinds = chars.map(charScript);
  const resolved = kinds.slice();
  for (let i = 0; i < chars.length; i++) {
    if (kinds[i] !== "neutral") continue;
    let left;
    for (let j = i - 1; j >= 0; j--) if (kinds[j] !== "neutral") { left = kinds[j]; break; }
    let right;
    for (let j = i + 1; j < chars.length; j++) if (kinds[j] !== "neutral") { right = kinds[j]; break; }
    resolved[i] = left ?? right ?? "latin";
  }
  const runs = [];
  chars.forEach((char, index) => {
    const last = runs.at(-1);
    if (last && last.script === resolved[index]) { last.text += char; last.end = index + 1; }
    else runs.push({ script: resolved[index], text: char, start: index, end: index + 1 });
  });
  return runs;
}

export function textScript(text) {
  const scripts = new Set(scriptRuns(text).map((run) => run.script));
  if (scripts.size > 1) return "mixed";
  return scripts.has("hangul") ? "hangul" : "latin";
}

// MO-A-13 / MO-FT-05: break candidates are whitespace boundaries only, so a 어절 never splits.
export function eojeols(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean);
}

export function unitCounts(text) {
  const value = String(text);
  const H = (value.match(hangulSyllable) ?? []).length;
  const withoutHangul = value.replace(/[ᄀ-ᇿ㄰-㆏가-힣]/gu, " ");
  const W = (withoutHangul.match(/[\p{L}\p{N}'’-]*[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const C = scriptRuns(value).filter((run) => run.script === "latin").reduce((sum, run) => sum + Array.from(run.text).length, 0);
  return { H, W, C };
}

// MO-C-07/08: the one reading-floor function, by timeline unit kind.
export function readingFloor(text, kind = "line") {
  if (kind === "reveal") return limits.revealFloor;
  const { H, W } = unitCounts(text);
  const rate = limits.secondsPerHangulSyllable * H + W / limits.latinWordsPerSecond;
  if (kind === "word") return Math.max(limits.wordFloor, rate);
  return Math.max(H > 0 ? limits.lineFloorHangul : limits.lineFloorLatin, rate);
}

// The 17 cps cross-check for line/scene units, stated as the hold it requires.
export function cpsFloor(text, kind = "line") {
  if (kind !== "line" && kind !== "scene") return 0;
  return unitCounts(text).C / limits.latinCharsPerSecond;
}

function keywordMatches(text, word) {
  if (/[a-z]/iu.test(word)) return new RegExp(`\\b${word}\\b`, "iu").test(text);
  return new RegExp(`(?:^|[^\\uAC00-\\uD7A3\\u1100-\\u11FF\\u3130-\\u318F])${word}`, "u").test(text);
}

// MO-B-00: an explicit style wins; otherwise the first table row with a whole-word hit.
export function selectPreset(text, explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    if (!Object.hasOwn(presets, explicit)) throw new Error(`Unknown preset: ${explicit}`);
    return { id: explicit, reason: "user-specified" };
  }
  for (const row of presetKeywordTable) {
    const hit = row.words.find((word) => keywordMatches(String(text), word));
    if (hit) return { id: row.preset, reason: `${row.reason} "${hit}"` };
  }
  return { id: "swiss-signal", reason: "no terminal or flow keyword in the brief, so the default" };
}
