// Bounded stdin reader owned by this skill, used by the offline validator CLI.
import { parseBoundedJson } from "./bounded-json.mjs";

export const maximumStdinBytes = 1024 * 1024;

export async function readBoundedJsonStream(stream, { maxBytes = maximumStdinBytes } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error(`stdin size ${total} bytes exceeds ${maxBytes} bytes`);
    chunks.push(bytes);
  }
  return parseBoundedJson(Buffer.concat(chunks, total), { maxBytes });
}
