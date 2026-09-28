// Minimal PNG writer and reader for the engine's own 8-bit frames (RGBA or grayscale, no
// interlace). The renderer uses it for stills, sheets, masks and preview-encoder input frames.
import { deflateSync, inflateSync } from "node:zlib";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffers) {
  let c = 0xffffffff;
  for (const buffer of buffers) for (let i = 0; i < buffer.length; i++) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, tail]);
}

// channels: 4 = RGBA (colour type 6), 1 = grayscale (colour type 0). `adaptive` picks the row filter
// with the smallest absolute residual sum (the usual heuristic); otherwise every row uses "sub".
export function encodePng(width, height, pixels, channels = 4, level = 6, adaptive = false) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const src = y * stride;
    let bestFilter = 1, bestScore = Infinity;
    for (const filter of adaptive ? [0, 1, 2, 3, 4] : [1]) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? pixels[src + x - channels] : 0;
        const b = y > 0 ? pixels[src - stride + x] : 0;
        const c = x >= channels && y > 0 ? pixels[src - stride + x - channels] : 0;
        let predictor = 0;
        if (filter === 1) predictor = a;
        else if (filter === 2) predictor = b;
        else if (filter === 3) predictor = (a + b) >> 1;
        else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const value = (pixels[src + x] - predictor) & 0xff;
        candidate[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) { bestScore = score; bestFilter = filter; candidate.copy(raw, row + 1); }
    }
    raw[row] = bestFilter;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs are supported");
      channels = { 0: 1, 2: 3, 6: 4 }[data[9]];
      if (!channels) throw new Error(`unsupported PNG colour type ${data[9]}`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let value = raw[src + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

// Exact area-average resize (fractional footprints), used for preview frames.
export function areaResize(src, sw, sh, dw, dh, channels = 4) {
  const xs = footprints(sw, dw), ys = footprints(sh, dh);
  const temp = new Float64Array(dw * sh * channels);
  for (let y = 0; y < sh; y++) for (let dx = 0; dx < dw; dx++) {
    for (const [x, w] of xs[dx]) {
      const s = (y * sw + x) * channels, t = (y * dw + dx) * channels;
      for (let c = 0; c < channels; c++) temp[t + c] += src[s + c] * w;
    }
  }
  const out = Buffer.alloc(dw * dh * channels);
  for (let dy = 0; dy < dh; dy++) for (let dx = 0; dx < dw; dx++) {
    const acc = new Float64Array(channels);
    for (const [y, w] of ys[dy]) {
      const t = (y * dw + dx) * channels;
      for (let c = 0; c < channels; c++) acc[c] += temp[t + c] * w;
    }
    const o = (dy * dw + dx) * channels;
    for (let c = 0; c < channels; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(acc[c])));
  }
  return out;
}

function footprints(size, count) {
  const step = size / count;
  return Array.from({ length: count }, (_, i) => {
    const a = i * step, b = (i + 1) * step, list = [];
    for (let p = Math.floor(a); p < Math.ceil(b); p++) {
      const w = Math.min(b, p + 1) - Math.max(a, p);
      if (w > 1e-9) list.push([p, w / step]);
    }
    return list;
  });
}
