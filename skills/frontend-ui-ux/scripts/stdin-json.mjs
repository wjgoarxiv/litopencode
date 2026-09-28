import { parseBoundedJson } from "./bounded-json.mjs";
import { jsonInvalid } from "./contract-error.mjs";

export const maximumStdinBytes = 1024 * 1024;

export async function readBoundedJsonStream(stream, { maxBytes = maximumStdinBytes } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw jsonInvalid(`stdin size ${total} bytes exceeds ${maxBytes} bytes`);
    chunks.push(bytes);
  }
  return parseBoundedJson(Buffer.concat(chunks, total), { maxBytes });
}
