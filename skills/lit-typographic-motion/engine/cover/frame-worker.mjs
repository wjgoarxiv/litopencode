// Worker thread for the cover capture: decode one 2x screenshot, reduce it to the cover size with
// Lanczos, write it as a PNG (the encoder's input, and what G0, G5, G6 and the seek check read)
// and return the SHA-256 of the reduced RGBA, so the browser can draw the next frame meanwhile.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { decodePng, encodePng } from "../png.mjs";
import { lanczosResize, rgbaOf } from "./image.mjs";

parentPort.on("message", ({ id, png, size: [width, height], file }) => {
  try {
    const shot = decodePng(Buffer.from(png));
    const small = lanczosResize(rgbaOf(shot), shot.width, shot.height, width, height);
    writeFileSync(file, encodePng(width, height, small, 4, 1));
    parentPort.postMessage({ id, sha256: createHash("sha256").update(small).digest("hex"), captured: `${shot.width}x${shot.height}` });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
