// The pinned encodes both render paths share: the H.264 master from raw RGBA frames (MO-A-03 args at
// the frame's own size and rate) and the looping preview's encoder ladder (MO-A-38).
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import path from "node:path";

export function encodeMaster(file, width, height, fps) {
  const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "grain",
    "-x264-params", "aq-mode=3", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart", file];
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  const chunks = [];
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  return { child, stderr: () => Buffer.concat(chunks).toString("utf8") };
}

export async function write(child, bytes) {
  if (!child.stdin.write(bytes)) await once(child.stdin, "drain");
}

// Preview size rungs: [long edge in px, fps]. The long edge is the width at 16:9 and the height at 9:16.
export function previewRungs() {
  return [[960, 30], [720, 24], [540, 20]];
}

export function previewSize(longEdge, width, height) {
  return width >= height
    ? { width: longEdge, height: Math.round((longEdge * height) / width / 2) * 2 }
    : { width: Math.round((longEdge * width) / height / 2) * 2, height: longEdge };
}

export async function encodePreview(runDir, frameDir, fps, count, encoder) {
  const pattern = path.join(frameDir, "p%05d.png");
  const target = path.join(runDir, encoder === "gif" ? "preview.gif" : "preview.webp");
  rmSync(path.join(runDir, "preview.webp"), { force: true });
  rmSync(path.join(runDir, "preview.gif"), { force: true });
  let result;
  if (encoder === "libwebp_anim") result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", pattern, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "78", "-loop", "0", target], { encoding: "utf8", timeout: 600000 });
  else if (encoder === "img2webp") {
    const files = Array.from({ length: count }, (_, k) => path.join(frameDir, `p${String(k).padStart(5, "0")}.png`));
    result = spawnSync("img2webp", ["-loop", "0", "-lossy", "-q", "78", "-m", "4", "-d", String(Math.round(1000 / fps)), ...files, "-o", target], { encoding: "utf8", timeout: 600000, maxBuffer: 16_000_000 });
  } else result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", pattern, "-filter_complex", "[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", target], { encoding: "utf8", timeout: 600000 });
  if (result.status !== 0) throw new Error(`preview encode (${encoder}) failed: ${(result.stderr || result.error?.message || "").trim().split("\n").slice(-2).join(" ")}`);
  return target;
}
