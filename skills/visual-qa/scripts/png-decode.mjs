import { decodePngStructure } from "./png.mjs";

const channels = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(parsed) {
  const rows = [];
  const bpp = Math.max(1, Math.ceil((channels[parsed.colorType] * parsed.bitDepth) / 8));
  let offset = 0;
  let previous = Buffer.alloc(parsed.rowBytes);
  for (let y = 0; y < parsed.height; y += 1) {
    const filter = parsed.scanlines[offset];
    const raw = parsed.scanlines.subarray(offset + 1, offset + 1 + parsed.rowBytes);
    const row = Buffer.alloc(parsed.rowBytes);
    if (filter > 4) throw new Error(`PNG filter ${filter} is invalid`);
    for (let x = 0; x < raw.length; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = previous[x] ?? 0;
      const upperLeft = x >= bpp ? previous[x - bpp] : 0;
      const predictor =
        filter === 0 ? 0 :
        filter === 1 ? left :
        filter === 2 ? up :
        filter === 3 ? Math.floor((left + up) / 2) :
        paeth(left, up, upperLeft);
      row[x] = (raw[x] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
    offset += parsed.rowBytes + 1;
  }
  return rows;
}

function rawSample(row, index, depth) {
  if (depth === 16) return row.readUInt16BE(index * 2);
  if (depth === 8) return row[index];
  const perByte = 8 / depth;
  const shift = 8 - depth * ((index % perByte) + 1);
  return (row[Math.floor(index / perByte)] >>> shift) & ((1 << depth) - 1);
}

function normalizedSample(row, index, depth) {
  const raw = rawSample(row, index, depth);
  return depth === 16 ? raw >>> 8 : Math.round((raw * 255) / ((1 << depth) - 1));
}

function transparencyKey(buffer, offset = 0) {
  return buffer?.length >= offset + 2 ? buffer.readUInt16BE(offset) : undefined;
}

export function decodePng(input) {
  const parsed = decodePngStructure(input);
  if (!parsed.ok) return parsed;
  let rows;
  try {
    rows = unfilter(parsed);
  } catch (error) {
    return { code: "PNG_DECODE_INVALID", detail: error instanceof Error ? error.message : String(error), ok: false };
  }
  const rgba = Buffer.alloc(parsed.width * parsed.height * 4);
  const count = channels[parsed.colorType];
  for (let y = 0; y < parsed.height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < parsed.width; x += 1) {
      const sample = x * count;
      const output = (y * parsed.width + x) * 4;
      let red;
      let green;
      let blue;
      let alpha = 255;
      if (parsed.colorType === 0) {
        const raw = rawSample(row, sample, parsed.bitDepth);
        red = normalizedSample(row, sample, parsed.bitDepth);
        green = red;
        blue = red;
        if (raw === transparencyKey(parsed.transparency)) alpha = 0;
      } else if (parsed.colorType === 2) {
        const rawRed = rawSample(row, sample, parsed.bitDepth);
        const rawGreen = rawSample(row, sample + 1, parsed.bitDepth);
        const rawBlue = rawSample(row, sample + 2, parsed.bitDepth);
        red = normalizedSample(row, sample, parsed.bitDepth);
        green = normalizedSample(row, sample + 1, parsed.bitDepth);
        blue = normalizedSample(row, sample + 2, parsed.bitDepth);
        if (
          rawRed === transparencyKey(parsed.transparency) &&
          rawGreen === transparencyKey(parsed.transparency, 2) &&
          rawBlue === transparencyKey(parsed.transparency, 4)
        ) alpha = 0;
      } else if (parsed.colorType === 3) {
        const index = rawSample(row, sample, parsed.bitDepth);
        const paletteOffset = index * 3;
        if (paletteOffset + 2 >= parsed.palette.length) {
          return { code: "PNG_PALETTE_INVALID", detail: `Palette index ${index} is absent`, ok: false };
        }
        red = parsed.palette[paletteOffset];
        green = parsed.palette[paletteOffset + 1];
        blue = parsed.palette[paletteOffset + 2];
        alpha = parsed.transparency?.[index] ?? 255;
      } else if (parsed.colorType === 4) {
        red = normalizedSample(row, sample, parsed.bitDepth);
        green = red;
        blue = red;
        alpha = normalizedSample(row, sample + 1, parsed.bitDepth);
      } else {
        red = normalizedSample(row, sample, parsed.bitDepth);
        green = normalizedSample(row, sample + 1, parsed.bitDepth);
        blue = normalizedSample(row, sample + 2, parsed.bitDepth);
        alpha = normalizedSample(row, sample + 3, parsed.bitDepth);
      }
      rgba.set([red, green, blue, alpha], output);
    }
  }
  return { height: parsed.height, ok: true, rgba, width: parsed.width };
}

export function comparePngs(expectedInput, actualInput) {
  const expected = decodePng(expectedInput);
  if (!expected.ok) return expected;
  const actual = decodePng(actualInput);
  if (!actual.ok) return actual;
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { code: "PNG_DIMENSION_MISMATCH", ok: false };
  }
  let difference = 0;
  let alphaDamagedPixels = 0;
  for (let index = 0; index < expected.rgba.length; index += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      difference += Math.abs(expected.rgba[index + channel] - actual.rgba[index + channel]);
    }
    if (expected.rgba[index + 3] !== actual.rgba[index + 3]) alphaDamagedPixels += 1;
  }
  return {
    alphaDamagedPixels,
    comparedPixels: expected.width * expected.height,
    ok: true,
    similarity: 1 - difference / (expected.rgba.length * 255)
  };
}
