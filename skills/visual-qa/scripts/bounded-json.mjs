// Bounded, containment-checked JSON file reader owned by this skill. Evidence
// manifests and review receipts arrive as untrusted bytes, so size, encoding,
// symlink, device, and authorized-root checks all run before any parse.
import fs from "node:fs/promises";
import path from "node:path";
import { parseStrictJson } from "./strict-json.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function parseBoundedJson(buffer, { maxBytes = 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("JSON input must be a Buffer");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer");
  if (buffer.length > maxBytes) throw new Error(`JSON input size ${buffer.length} bytes exceeds ${maxBytes} bytes`);
  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    throw new Error("JSON input is not valid UTF-8");
  }
  return parseStrictJson(text);
}

export async function readBoundedJsonFile(
  filePath,
  { authorizedRoot, maxBytes = 1024 * 1024, validate = (value) => value } = {}
) {
  if (typeof filePath !== "string" || filePath.length === 0) throw new Error("filePath is required");
  if (typeof authorizedRoot !== "string" || authorizedRoot.length === 0) {
    throw new Error("authorizedRoot is required");
  }
  const rootPath = path.resolve(authorizedRoot);
  const requested = path.resolve(filePath);
  if (!inside(rootPath, requested)) throw new Error("JSON path is outside the authorized root");
  const root = await fs.realpath(rootPath);
  const stat = await fs.lstat(requested);
  if (stat.isSymbolicLink()) throw new Error("JSON path must not be a symlink");
  if (!stat.isFile()) throw new Error("JSON path must be a regular file, not a device");
  if (stat.size > maxBytes) throw new Error(`JSON file size ${stat.size} bytes exceeds ${maxBytes} bytes`);
  const resolved = await fs.realpath(requested);
  if (!inside(root, resolved)) throw new Error("Resolved JSON path is outside the authorized root");
  return validate(parseBoundedJson(await fs.readFile(resolved), { maxBytes }));
}
