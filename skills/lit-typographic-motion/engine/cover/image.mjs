// Pixel helpers for cover mode, on RGBA8 buffers. The 2x capture is reduced to the cover size with a
// Lanczos-3 filter (sharper than the box filter the film preview uses, so thin light edges survive);
// the gate measures luma on a box grid about 300 px wide, which is what a thumbnail shows; and the
// frame-0 art check compares two crops with a tiled SSIM.

const LOBES = 3;
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x) => (Math.abs(x) < LOBES ? sinc(x) * sinc(x / LOBES) : 0);

// One filter row per output pixel: the first source index and the normalised weights. Shrinking
// widens the kernel by the scale, so every source pixel contributes.
const tapCache = new Map();
function taps(source, target) {
  const key = `${source}>${target}`;
  if (tapCache.has(key)) return tapCache.get(key);
  const scale = source / target;
  const stretch = Math.max(1, scale);
  const reach = LOBES * stretch;
  const rows = [];
  for (let i = 0; i < target; i++) {
    const centre = (i + 0.5) * scale - 0.5;
    const first = Math.max(0, Math.ceil(centre - reach));
    const last = Math.min(source - 1, Math.floor(centre + reach));
    const weights = new Float64Array(last - first + 1);
    let total = 0;
    for (let j = first; j <= last; j++) total += weights[j - first] = lanczos((j - centre) / stretch);
    for (let k = 0; k < weights.length; k++) weights[k] /= total;
    rows.push({ first, weights });
  }
  tapCache.set(key, rows);
  return rows;
}

const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** Lanczos-3 resize of an opaque RGBA8 image; the result is opaque (alpha 255). */
export function lanczosResize(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return Buffer.from(src);
  const across = taps(sw, dw);
  const down = taps(sh, dh);
  const mid = new Float32Array(dw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const { first, weights } = across[x];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < weights.length; k++) {
        const s = row + (first + k) * 4, w = weights[k];
        r += src[s] * w; g += src[s + 1] * w; b += src[s + 2] * w;
      }
      const m = (y * dw + x) * 3;
      mid[m] = r; mid[m + 1] = g; mid[m + 2] = b;
    }
  }
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const { first, weights } = down[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < weights.length; k++) {
        const m = ((first + k) * dw + x) * 3, w = weights[k];
        r += mid[m] * w; g += mid[m + 1] * w; b += mid[m + 2] * w;
      }
      const o = (y * dw + x) * 4;
      out[o] = byte(r); out[o + 1] = byte(g); out[o + 2] = byte(b); out[o + 3] = 255;
    }
  }
  return out;
}

export const LUMA_WIDTH = 300;

/** Rec. 709 luma (0..255) box-averaged to about LUMA_WIDTH wide: { luma, width, height }. */
export function lumaGrid(rgba, width, height) {
  const step = Math.max(1, Math.round(width / LUMA_WIDTH));
  const w = Math.floor(width / step), h = Math.floor(height / step);
  const luma = new Float32Array(w * h);
  for (let y = 0; y < h * step; y++) {
    const cell = Math.floor(y / step) * w;
    for (let x = 0; x < w * step; x++) {
      const p = (y * width + x) * 4;
      luma[cell + Math.floor(x / step)] += 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
  }
  const area = step * step;
  for (let i = 0; i < luma.length; i++) luma[i] /= area;
  return { luma, width: w, height: h };
}

/** Mean |a - b| over two luma grids, as a share of 255. */
export function meanLumaStep(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

/** The [x, y, w, h] rectangle of an RGBA8 frame `width` pixels wide. */
export function crop(rgba, width, [x, y, w, h]) {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) rgba.copy(out, row * w * 4, ((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4);
  return out;
}

/** Structural similarity of two same-size RGBA8 images on luma: the mean over 8x8 tiles. */
export function ssim(a, b, width, height) {
  const tile = 8;
  const c1 = (0.01 * 255) ** 2, c2 = (0.03 * 255) ** 2;
  const lum = (img, i) => 0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2];
  let total = 0, tiles = 0;
  for (let ty = 0; ty + tile <= height; ty += tile) {
    for (let tx = 0; tx + tile <= width; tx += tile) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = ty; y < ty + tile; y++) {
        for (let x = tx; x < tx + tile; x++) {
          const i = y * width + x, la = lum(a, i), lb = lum(b, i);
          sa += la; sb += lb; saa += la * la; sbb += lb * lb; sab += la * lb;
        }
      }
      const n = tile * tile;
      const ma = sa / n, mb = sb / n;
      const va = (saa - n * ma * ma) / (n - 1), vb = (sbb - n * mb * mb) / (n - 1), cov = (sab - n * ma * mb) / (n - 1);
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      tiles += 1;
    }
  }
  return tiles ? total / tiles : 0;
}

/** An RGBA8 copy of a decoded PNG ({ width, height, channels, pixels }). */
export function rgbaOf(image) {
  if (image.channels === 4) return image.pixels;
  const out = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; j < out.length; i += image.channels, j += 4) {
    const grey = image.channels < 3;
    out[j] = image.pixels[i]; out[j + 1] = grey ? image.pixels[i] : image.pixels[i + 1]; out[j + 2] = grey ? image.pixels[i] : image.pixels[i + 2]; out[j + 3] = 255;
  }
  return out;
}
