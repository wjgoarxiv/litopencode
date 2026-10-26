// The cover's asset list, `<out>/assets.json`. Every raster the cover page can load (base art, logo,
// wordmark, texture) is listed with its path, role, source (user: supplied; fetched: taken from the
// product's own pages by `render.mjs assets --cover`; generated: made for this cover and labelled so
// in the reply) and SHA-256, and the renderer checks the list before the first capture. The art is
// supplied, fetched or generated, never replaced by a drawn stand-in: a listed file that is missing
// stops the run as BLOCKED_ASSET_MISSING (exit 22), and so does the painted-light recipe with no
// user-supplied base art listed. After the render, decoded frame 0 must show the base art (artCheck).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { COVER, EXIT } from "../constants.mjs";
import { crop, lanczosResize, ssim } from "./image.mjs";

export const ASSET_ROLES = Object.freeze(["base-art", "logo", "wordmark", "texture"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stop = (code, name, detail) => Object.assign(new Error(`${name} (${code}): ${detail}`), { exitCode: code });
const badEntry = (field, detail) => stop(EXIT.BLOCKED_TREATMENT_INVALID, "BLOCKED_TREATMENT_INVALID", `assets.json ${field}: ${detail}`);
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && v >= 0 && v <= 1) && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1 + 1e-9 && b[1] + b[3] <= 1 + 1e-9;
const inside = (inner, outer) => inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[0] + inner[2] <= outer[0] + outer[2] + 1e-9 && inner[1] + inner[3] <= outer[1] + outer[3] + 1e-9;

/**
 * Check `<out>/assets.json` against the rasters the static scan found in the cover folder (paths
 * relative to that folder). Returns the listed assets. Exit 22: a listed file is missing, or the
 * painted-light recipe has no base art. Exit 17: a raster the list does not name, or a file whose
 * hash changed since it was listed. Exit 16: a malformed entry.
 */
export function checkAssets({ out, treatment, rasters, coverDir = "cover" }) {
  const file = path.join(out, "assets.json");
  let assets = [];
  if (existsSync(file)) {
    let doc;
    try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw badEntry("file", `not JSON (${error.message})`); }
    if (!Array.isArray(doc?.assets)) throw badEntry("assets", "must be an array of { path, role, source, sha256 }");
    assets = doc.assets.map((entry, i) => {
      const at = `assets[${i}]`;
      if (!entry || typeof entry !== "object") throw badEntry(at, "must be an object");
      if (typeof entry.path !== "string" || !entry.path.startsWith(`${coverDir}/`) || entry.path.split("/").includes("..")) throw badEntry(`${at}.path`, `must be a path inside ${coverDir}/, relative to the output directory`);
      if (!ASSET_ROLES.includes(entry.role)) throw badEntry(`${at}.role`, `must be one of ${ASSET_ROLES.join(", ")}`);
      if (!["user", "fetched", "generated"].includes(entry.source)) throw badEntry(`${at}.source`, "must be user (supplied), fetched (by render.mjs assets --cover) or generated");
      if (!/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) throw badEntry(`${at}.sha256`, "must be the file's SHA-256 (64 hex digits)");
      if ("box" in entry && !isBox(entry.box)) throw badEntry(`${at}.box`, "must be [x, y, w, h] as fractions of the cover, inside it");
      if (entry.role === "base-art" && !entry.box) throw badEntry(`${at}.box`, "base art needs the box it fills on the cover");
      if (entry.role === "base-art" && !/\.png$/iu.test(entry.path)) throw badEntry(`${at}.path`, "base art is a PNG, so frame 0 can be compared with it");
      if ("checkBox" in entry) {
        if (!isBox(entry.checkBox) || !entry.box || !inside(entry.checkBox, entry.box)) throw badEntry(`${at}.checkBox`, "must be [x, y, w, h] inside the art's box");
        if (entry.checkBox[2] * entry.checkBox[3] < COVER.artMinShare * entry.box[2] * entry.box[3]) throw badEntry(`${at}.checkBox`, `must cover at least ${COVER.artMinShare * 100} % of the art's box`);
      }
      return { path: entry.path, role: entry.role, source: entry.source, sha256: entry.sha256, box: entry.box ?? null, checkBox: entry.checkBox ?? null, title: entry.title === true };
    });
    for (const asset of assets) {
      const real = path.join(out, asset.path);
      if (!existsSync(real)) throw stop(EXIT.BLOCKED_ASSET_MISSING, "BLOCKED_ASSET_MISSING", `${asset.path} is listed in assets.json and is not there; supply it or generate it, never draw a stand-in`);
      if (sha256(readFileSync(real)) !== asset.sha256) throw stop(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `${asset.path} no longer matches its sha256 in assets.json; list it again after changing it`);
    }
  }
  // The painted recipe relights a painting the user supplied. Without one the cover takes hero-3d
  // (or weight-tide, orbit-loop) instead of a stand-in painting drawn for the occasion.
  if (treatment.recipe === "painted-light" && !assets.some((asset) => asset.role === "base-art" && asset.source === "user")) {
    throw stop(EXIT.BLOCKED_ASSET_MISSING, "BLOCKED_ASSET_MISSING", "the painted-light recipe relights a painting, and assets.json lists no base-art with source user: a painting the user supplied; without one, take hero-3d (or weight-tide, orbit-loop), never draw or generate a stand-in");
  }
  const listed = new Set(assets.map((asset) => asset.path));
  for (const raster of rasters) {
    const rel = `${coverDir}/${raster.rel.split(path.sep).join("/")}`;
    if (!listed.has(rel)) throw stop(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `${rel} is a raster the page can load and assets.json does not list it; list it with its role, source and sha256`);
  }
  return assets;
}

/**
 * Frame 0 is the poster and shows the base art: crop the check box (by default the whole art box)
 * out of decoded frame 0 and compare it with the same region of the source scaled into the art box.
 * `art` is { rgba, width, height }; boxes are fractions of the cover.
 */
export function artCheck({ frame0, width, height, art, box, checkBox = null }) {
  const px = (b) => b.map((v, k) => Math.round(v * (k % 2 ? height : width)));
  const [bx, by, bw, bh] = px(box);
  const [cx, cy, cw, ch] = px(checkBox ?? box);
  const scaled = lanczosResize(art.rgba, art.width, art.height, bw, bh);
  const value = ssim(crop(frame0, width, [cx, cy, cw, ch]), crop(scaled, bw, [cx - bx, cy - by, cw, ch]), cw, ch);
  return { ssim: value, pass: value >= COVER.artSsim, checked: [cx, cy, cw, ch] };
}

/** The reply labels a finished cover owes: one per asset the list marks as generated. */
export function generatedAssetLabels(out) {
  const file = path.join(out, "assets.json");
  if (!existsSync(file)) return [];
  try {
    return (JSON.parse(readFileSync(file, "utf8")).assets ?? [])
      .filter((asset) => asset?.source === "generated" && typeof asset.path === "string")
      .map((asset) => `generated: ${asset.path} (${String(asset.role ?? "asset").replace("-", " ")}) was made for this cover, not supplied; label it as generated in the reply`);
  } catch {
    return [];
  }
}
