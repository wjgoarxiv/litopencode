// Worker thread for the stage capture: decodes one screenshot PNG to exact RGBA, hashes it, computes
// the flash-audit cells and the near-black statistic, and makes the preview-sized copy when asked, so
// the browser can step the next frame while this one is analysed.
import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { auditCells, flashGeometryFor, linearLut } from "../flash.mjs";
import { areaResize, decodePng, encodePng } from "../png.mjs";

function toRgba(image) {
  if (image.channels === 4) return image.pixels;
  const out = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += image.channels, j += 4) {
    const g = image.channels === 1;
    out[j] = image.pixels[i]; out[j + 1] = g ? image.pixels[i] : image.pixels[i + 1]; out[j + 2] = g ? image.pixels[i] : image.pixels[i + 2]; out[j + 3] = 255;
  }
  return out;
}

// p99.5 of linear luminance, the near-black statistic MO-D-03 reads.
function p995(rgba) {
  const bins = new Uint32Array(1024);
  for (let i = 0; i < rgba.length; i += 4) bins[Math.min(1023, Math.floor((0.2126 * linearLut[rgba[i]] + 0.7152 * linearLut[rgba[i + 1]] + 0.0722 * linearLut[rgba[i + 2]]) * 1024))]++;
  const target = (rgba.length / 4) * 0.995;
  let acc = 0;
  for (let b = 0; b < 1024; b++) { acc += bins[b]; if (acc >= target) return (b + 1) / 1024; }
  return 1;
}

parentPort.on("message", ({ id, png, width, height, preview }) => {
  try {
    const image = decodePng(Buffer.from(png));
    if (image.width !== width || image.height !== height) {
      parentPort.postMessage({ id, error: `the capture is ${image.width}x${image.height}, not ${width}x${height}` });
      return;
    }
    const rgba = toRgba(image);
    const cells = auditCells(rgba, width, height, flashGeometryFor(width, height));
    const hash = createHash("sha256").update(rgba).digest("hex");
    const out = { id, hash, p995L: Number(p995(rgba).toFixed(5)), cells };
    if (preview) out.previewPng = encodePng(preview.width, preview.height, areaResize(rgba, width, height, preview.width, preview.height, 4), 4, 1);
    const copy = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? new Uint8Array(rgba.buffer) : Uint8Array.from(rgba);
    out.rgba = copy;
    parentPort.postMessage(out, [copy.buffer, cells.R.buffer, cells.G.buffer, cells.B.buffer, cells.L.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
