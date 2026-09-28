// MO-C-06 type contrast measured on rendered frames with the glyph-coverage mask (CF-204's method
// on a video frame), and MO-C-29's saturated-hue cluster count.
import { linearLut } from "./flash.mjs";
import { limits } from "./constants.mjs";

const relative = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function percentile(values, q) {
  if (values.length === 0) return NaN;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

// CRT barrel: output pixel (u, v) shows the source at (u, v) + d * |d|^2 * k, d = (u, v) - 0.5.
export function warpMask(mask, width, height, curvature) {
  if (!curvature) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width - 0.5, v = (y + 0.5) / height - 0.5;
    const r2 = u * u + v * v;
    const sx = Math.floor((u + u * r2 * curvature + 0.5) * width), sy = Math.floor((v + v * r2 * curvature + 0.5) * height);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height) out[y * width + x] = mask[sy * width + sx];
  }
  return out;
}

function morph(mask, width, height, x0, y0, x1, y1, radius, erode) {
  const out = new Uint8Array((x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let value = erode ? 1 : 0;
    for (let dy = -radius; dy <= radius && (erode ? value : !value); dy++) for (let dx = -radius; dx <= radius; dx++) {
      const sx = x + dx, sy = y + dy;
      const on = sx >= 0 && sy >= 0 && sx < width && sy < height && mask[sy * width + sx] > 127;
      if (erode && !on) { value = 0; break; }
      if (!erode && on) { value = 1; break; }
    }
    out[(y - y0) * (x1 - x0) + (x - x0)] = value;
  }
  return out;
}

const lum = (rgba, i) => 0.2126 * linearLut[rgba[i]] + 0.7152 * linearLut[rgba[i + 1]] + 0.0722 * linearLut[rgba[i + 2]];

// One textBoxes entry: foreground = median linear luminance under the mask eroded by 1 px (5th and
// 95th percentiles for a gradient fill); background = 5th/95th percentiles inside the bbox grown by
// 0.25 x cap height, outside the mask dilated by 2 px. The ratio is the worst pairing.
// `large` overrides the type engine's size rule (the stage judges large as 3 % of the short side).
export function boxContrast(rgba, mask, width, height, box, scale = 1, large = undefined) {
  const [bx0, by0, bx1, by1] = box.bbox.map((v) => v * scale);
  const grow = 0.25 * box.capHeightPx * scale;
  const clampX = (v) => Math.max(0, Math.min(width, Math.round(v))), clampY = (v) => Math.max(0, Math.min(height, Math.round(v)));
  const ix0 = clampX(bx0), iy0 = clampY(by0), ix1 = clampX(bx1), iy1 = clampY(by1);
  const ox0 = clampX(bx0 - grow), oy0 = clampY(by0 - grow), ox1 = clampX(bx1 + grow), oy1 = clampY(by1 + grow);
  if (ix1 <= ix0 || iy1 <= iy0) return null;
  const eroded = morph(mask, width, height, ix0, iy0, ix1, iy1, Math.max(1, Math.round(scale)), true);
  const fg = [];
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (eroded[(y - iy0) * (ix1 - ix0) + (x - ix0)]) fg.push(lum(rgba, (y * width + x) * 4));
  const dilated = morph(mask, width, height, ox0, oy0, ox1, oy1, Math.max(2, Math.round(2 * scale)), false);
  const bg = [];
  for (let y = oy0; y < oy1; y++) for (let x = ox0; x < ox1; x++) if (!dilated[(y - oy0) * (ox1 - ox0) + (x - ox0)]) bg.push(lum(rgba, (y * width + x) * 4));
  if (fg.length < 4 || bg.length < 4) return null;
  const fgValues = box.fill === "gradient" ? [percentile(fg, 0.05), percentile(fg, 0.95)] : [percentile(fg, 0.5)];
  const bgValues = [percentile(bg, 0.05), percentile(bg, 0.95)];
  let worst = Infinity;
  for (const f of fgValues) for (const b of bgValues) worst = Math.min(worst, relative(f, b));
  const isLarge = large ?? (box.fontSizePx >= limits.largeFontPx || (box.fontSizePx >= limits.largeBoldFontPx && box.weight >= limits.largeBoldWeight));
  return { ratio: worst, floor: isLarge ? limits.largeContrast : limits.bodyContrast, large: isLarge, fgPixels: fg.length, bgPixels: bg.length };
}

export function hexToHsl(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// MO-C-29: saturated fills (HSL S >= 50%, region >= 24x24 logical px) grouped into +-15 degree hue
// clusters. Each observation is { color, frame, entryId }.
export function hueClusters(observations) {
  const clusters = [];
  for (const obs of observations) {
    const { h, s } = hexToHsl(obs.color);
    if (s < limits.clusterSaturation) continue;
    let cluster = clusters.find((c) => hueDistance(c.hue, h) <= limits.clusterHueDeg);
    if (!cluster) { cluster = { hue: h, colors: new Set(), frames: new Set(), entries: new Set() }; clusters.push(cluster); }
    cluster.colors.add(obs.color.toUpperCase());
    cluster.frames.add(obs.frame);
    cluster.entries.add(obs.entryId);
  }
  return clusters.map((c) => ({ hue: Math.round(c.hue), colors: [...c.colors], frames: c.frames.size, entries: [...c.entries] }));
}

export function bigEnough(bbox) {
  return bbox && bbox[2] - bbox[0] >= limits.clusterMinSidePx && bbox[3] - bbox[1] >= limits.clusterMinSidePx;
}
