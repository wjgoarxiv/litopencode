function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
  if (typeof value !== "object") throw new Error(`Canonical JSON rejects ${typeof value}`);
  if (seen.has(value)) throw new Error("Canonical JSON rejects cyclic input");
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = normalize(value[key], seen);
  seen.delete(value);
  return output;
}

export function canonicalizeValue(value) {
  return normalize(value, new Set());
}

// Canonical form: object keys sorted recursively, array order preserved, and the
// document terminated by a single newline. Every hash in this system is taken
// over that exact byte sequence, so the newline is part of the contract.
export function canonicalJson(value) {
  return `${JSON.stringify(canonicalizeValue(value))}\n`;
}
