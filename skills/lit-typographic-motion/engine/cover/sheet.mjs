// The cover's review picture: twelve decoded frames (4 x 3) above a plot of every grid step's luma
// change over the whole loop. The plot shows what single stills cannot: a hold is a flat run on the
// red dashed still line, an encoder pop is a regular spike, a reset is a spike at the right end, the
// green dotted line is the median. White ticks mark where each tile sits in the loop, and amber
// shading marks a span (a logged defect, a re-rendered window). It is drawn in plain RGBA like the
// film contact sheet, with no browser, so the same frames always give the same picture.
import { COVER } from "../constants.mjs";
import { lanczosResize } from "./image.mjs";

const GAP = 8, PLOT_H = 170, COLS = 4;
const INK = Object.freeze({ ground: [8, 11, 16], plot: [17, 22, 29], line: [255, 122, 70], still: [190, 60, 60], median: [90, 170, 130], tick: [220, 225, 232], mark: [255, 176, 46] });

function canvas(width, height, fill) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = fill[0]; pixels[i + 1] = fill[1]; pixels[i + 2] = fill[2]; pixels[i + 3] = 255; }
  return { width, height, pixels };
}
function dot(img, x, y, color, alpha = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const p = (y * img.width + x) * 4;
  for (let c = 0; c < 3; c++) img.pixels[p + c] = Math.round(img.pixels[p + c] * (1 - alpha) + color[c] * alpha);
}
function rect(img, x, y, w, h, color, alpha = 1) {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) dot(img, xx, yy, color, alpha);
}
function segment(img, x0, y0, x1, y1, color, width = 1.5) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    for (let d = -Math.floor(width / 2); d <= Math.floor(width / 2); d++) dot(img, x, y + d, color);
  }
}
function dashed(img, x0, x1, y, color, on, off) {
  for (let x = x0; x < x1; x += on + off) rect(img, x, y, Math.min(on, x1 - x), 1, color);
}

/**
 * Compose the sheet. `tiles` are { rgba, width, height, at } (at = position in the loop, 0..1);
 * `steps` are the grid steps of the loop; `marks` are { from, to } spans as shares of the loop.
 * Returns { width, height, pixels } (RGBA).
 */
export function composeSheet({ tiles, steps, medianD, marks = [], tileWidth = 400 }) {
  const tileHeight = Math.round((tileWidth * tiles[0].height) / tiles[0].width);
  const rows = Math.ceil(tiles.length / COLS);
  const width = COLS * tileWidth + (COLS + 1) * GAP;
  const plotTop = rows * (tileHeight + GAP) + 2 * GAP;
  const img = canvas(width, plotTop + PLOT_H + 2 * GAP, INK.ground);
  tiles.forEach((tile, k) => {
    const small = lanczosResize(tile.rgba, tile.width, tile.height, tileWidth, tileHeight);
    const x0 = GAP + (k % COLS) * (tileWidth + GAP), y0 = GAP + Math.floor(k / COLS) * (tileHeight + GAP);
    for (let y = 0; y < tileHeight; y++) small.copy(img.pixels, ((y0 + y) * width + x0) * 4, y * tileWidth * 4, (y + 1) * tileWidth * 4);
  });
  const plotW = width - 2 * GAP;
  rect(img, GAP, plotTop, plotW, PLOT_H, INK.plot);
  for (const mark of marks) rect(img, GAP + mark.from * plotW, plotTop, Math.max(2, (mark.to - mark.from) * plotW), PLOT_H, INK.mark, 0.22);
  const top = Math.max(0.01, ...steps) * 1.05;
  const yOf = (v) => plotTop + PLOT_H - 1 - (Math.min(v, top) / top) * (PLOT_H - 2);
  const xOf = (i) => GAP + (steps.length > 1 ? (i / (steps.length - 1)) * (plotW - 1) : 0);
  dashed(img, GAP, GAP + plotW, Math.round(yOf(COVER.stillEps)), INK.still, 5, 4);
  dashed(img, GAP, GAP + plotW, Math.round(yOf(medianD)), INK.median, 2, 3);
  for (const tile of tiles) rect(img, GAP + tile.at * (plotW - 1), plotTop + PLOT_H - 7, 1, 7, INK.tick);
  for (let i = 1; i < steps.length; i++) segment(img, xOf(i - 1), yOf(steps[i - 1]), xOf(i), yOf(steps[i]), INK.line);
  return img;
}
