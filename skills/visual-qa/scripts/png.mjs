import { inflateSync } from "node:zlib";

const signature = Buffer.from("89504e470d0a1a0a", "hex");
const maximumFileBytes = 25 * 1024 * 1024;
const maximumAxis = 16_384;
const maximumPixels = 64_000_000;
const maximumDecodedBytes = 256 * 1024 * 1024;
const allowedDepths = Object.freeze({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16]
});
const channels = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rejected(code, detail) {
  return { code, detail, ok: false };
}

function dimensionFailure(width, height, bitDepth = 8, colorType = 6) {
  if (width < 1 || height < 1 || width > maximumAxis || height > maximumAxis) {
    return rejected("PNG_DIMENSION_LIMIT", `PNG dimensions ${width}x${height} exceed the positive ${maximumAxis}-pixel axis limit`);
  }
  if (width * height > maximumPixels) return rejected("PNG_RESOURCE_LIMIT", "PNG exceeds 64 megapixels");
  const channelCount = channels[colorType] ?? 4;
  const decodedBytes = Math.ceil((width * height * channelCount * bitDepth) / 8);
  if (decodedBytes > maximumDecodedBytes) return rejected("PNG_RESOURCE_LIMIT", "PNG decoded storage exceeds 256 MiB");
  return undefined;
}

function preflightDimensions(input) {
  if (input.length < 24 || input.readUInt32BE(8) !== 13 || input.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return dimensionFailure(input.readUInt32BE(16), input.readUInt32BE(20));
}

function parseIhdr(data) {
  if (data.length !== 13) return { failure: rejected("PNG_IHDR_INVALID", "IHDR length must be 13") };
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  if (!(colorType in allowedDepths) || !allowedDepths[colorType].includes(bitDepth)) {
    return { failure: rejected("PNG_COLOR_DEPTH_INVALID", `Unsupported color type ${colorType} and bit depth ${bitDepth}`) };
  }
  if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
    return { failure: rejected("PNG_IHDR_INVALID", "Unsupported compression, filter, or interlace method") };
  }
  return { bitDepth, colorType, height, width, failure: dimensionFailure(width, height, bitDepth, colorType) };
}

export function decodePngStructure(input) {
  if (!Buffer.isBuffer(input)) throw new TypeError("PNG input must be a Buffer");
  if (input.length > maximumFileBytes) return rejected("PNG_FILE_LIMIT", "PNG exceeds 25 MiB");
  if (input.length < signature.length || !input.subarray(0, signature.length).equals(signature)) {
    return rejected("PNG_SIGNATURE_INVALID", "PNG signature is missing or invalid");
  }
  const preflight = preflightDimensions(input);
  if (preflight !== undefined) return preflight;

  let offset = signature.length;
  let ihdr;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  const compressed = [];
  let palette;
  let transparency;
  while (offset < input.length) {
    if (input.length - offset < 12) return rejected("PNG_TRUNCATED", "PNG chunk framing is truncated");
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > input.length) return rejected("PNG_TRUNCATED", "PNG chunk payload or CRC is truncated");
    const type = input.toString("ascii", offset + 4, offset + 8);
    const data = input.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = input.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(input.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) return rejected("PNG_CRC_INVALID", `PNG ${type} CRC mismatch`);
    if (offset === signature.length && type !== "IHDR") return rejected("PNG_CHUNK_ORDER_INVALID", "IHDR must be first");
    if (type === "IHDR") {
      if (ihdr !== undefined) return rejected("PNG_CHUNK_ORDER_INVALID", "IHDR must occur once");
      ihdr = parseIhdr(data);
      if (ihdr.failure !== undefined) return ihdr.failure;
    } else if (type === "IDAT") {
      if (ihdr === undefined || endedIdat) return rejected("PNG_CHUNK_ORDER_INVALID", "IDAT order is invalid");
      sawIdat = true;
      compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !sawIdat) return rejected("PNG_CHUNK_ORDER_INVALID", "IEND must follow image data and be empty");
      sawIend = true;
      offset = end;
      break;
    } else if (type === "PLTE") {
      if (sawIdat || data.length === 0 || data.length % 3 !== 0 || data.length > 768) {
        return rejected("PNG_PALETTE_INVALID", "PLTE must precede IDAT and contain 1 to 256 RGB entries");
      }
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      if (sawIdat) return rejected("PNG_CHUNK_ORDER_INVALID", "tRNS must precede IDAT");
      transparency = Buffer.from(data);
    } else {
      if (sawIdat) endedIdat = true;
      if (/^[A-Z]/u.test(type)) return rejected("PNG_CRITICAL_CHUNK_UNSUPPORTED", `Unsupported critical chunk ${type}`);
    }
    offset = end;
  }
  if (!sawIend) return rejected("PNG_TRUNCATED", "PNG is missing IEND");
  if (offset !== input.length) return rejected("PNG_TRAILING_DATA", "PNG contains data after IEND");

  const rowBytes = Math.ceil((ihdr.width * channels[ihdr.colorType] * ihdr.bitDepth) / 8);
  const expectedDecoded = (rowBytes + 1) * ihdr.height;
  if (expectedDecoded > maximumDecodedBytes) return rejected("PNG_RESOURCE_LIMIT", "PNG decoded scanlines exceed 256 MiB");
  try {
    const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: maximumDecodedBytes });
    if (decoded.length !== expectedDecoded) return rejected("PNG_DECODE_INVALID", "PNG decoded scanline length is invalid");
    if (ihdr.colorType === 3 && palette === undefined) return rejected("PNG_PALETTE_INVALID", "Indexed PNG requires PLTE");
    return {
      bitDepth: ihdr.bitDepth,
      colorType: ihdr.colorType,
      decodedBytes: decoded.length,
      height: ihdr.height,
      ok: true,
      palette,
      rowBytes,
      scanlines: decoded,
      transparency,
      width: ihdr.width
    };
  } catch (error) {
    return rejected("PNG_DECODE_INVALID", error instanceof Error ? error.message : String(error));
  }
}

export function inspectPng(input) {
  const parsed = decodePngStructure(input);
  if (!parsed.ok) return parsed;
  return {
    bitDepth: parsed.bitDepth,
    colorType: parsed.colorType,
    decodedBytes: parsed.decodedBytes,
    height: parsed.height,
    ok: true,
    width: parsed.width
  };
}
