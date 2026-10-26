// How full a rendered frame is. `busyShare` reads the share of 48 px cells that carry anything
// (DEAD-AIR) and `regionFill` reads it per region of a 4 x 3 grid (RICH-FILL). A dense reference
// frame (a full dashboard) measured 0.57 or more in every region; films with an empty half measured
// 0.00-0.10 there. Opaque RGBA frames in, 0..1 shares out; pure, so the gate tests drive it directly.
export const FILL_GRID = Object.freeze({ cols: 4, rows: 3 });

const luma8 = (p, o) => Math.round(0.299 * p[o] + 0.587 * p[o + 1] + 0.114 * p[o + 2]);

// A cell is busy when its luma varies (sd > 6) or its mean sits more than 16 levels off the frame's
// ground, the most common luma smoothed over +-3 levels. Sampled on a 3 px lattice.
export function busyShare(rgba, width, height, { cell = 48, step = 3 } = {}) {
  const hist = new Uint32Array(256);
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) hist[luma8(rgba, (y * width + x) * 4)] += 1;
  let ground = 0;
  let best = -1;
  for (let i = 0; i < 256; i++) {
    let s = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(255, i + 3); k++) s += hist[k];
    if (s > best) [best, ground] = [s, i];
  }
  let busy = 0;
  let cells = 0;
  for (let cy = 0; cy + cell <= height; cy += cell) {
    for (let cx = 0; cx + cell <= width; cx += cell) {
      let sum = 0, sumSq = 0, n = 0;
      for (let y = cy; y < cy + cell; y += step) for (let x = cx; x < cx + cell; x += step) {
        const l = luma8(rgba, (y * width + x) * 4);
        sum += l; sumSq += l * l; n += 1;
      }
      const mean = sum / n;
      if (Math.sqrt(Math.max(0, sumSq / n - mean * mean)) > 6 || Math.abs(mean - ground) > 16) busy += 1;
      cells += 1;
    }
  }
  return cells ? busy / cells : 0;
}

// The busyShare of each region of the FILL_GRID, row by row.
export function regionFill(rgba, width, height) {
  const out = [];
  const rw = Math.floor(width / FILL_GRID.cols);
  const rh = Math.floor(height / FILL_GRID.rows);
  for (let r = 0; r < FILL_GRID.rows; r++) {
    for (let c = 0; c < FILL_GRID.cols; c++) {
      const sub = new Uint8Array(rw * rh * 4);
      for (let y = 0; y < rh; y++) {
        const from = ((r * rh + y) * width + c * rw) * 4;
        sub.set(rgba.subarray(from, from + rw * 4), y * rw * 4);
      }
      out.push(busyShare(sub, rw, rh));
    }
  }
  return out;
}
