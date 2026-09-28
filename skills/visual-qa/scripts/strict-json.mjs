// Strict JSON reader owned by this skill: duplicate keys, NUL bytes, and trailing
// data are refused so an evidence payload cannot be read two different ways.
function fail(message, offset) {
  throw new Error(`Malformed JSON at byte ${Buffer.byteLength(message.slice(0, offset), "utf8")}: ${message}`);
}

export function parseStrictJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON payload must be a UTF-8 string");
  if (text.includes("\0")) throw new Error("Malformed JSON: NUL bytes are forbidden");
  let index = 0;

  function whitespace() {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
  }

  function string() {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail("invalid string escape", start);
        }
      }
      if (text[index] === "\\") index += 1;
      index += 1;
    }
    fail("unterminated string", start);
  }

  function value() {
    whitespace();
    const token = text[index];
    if (token === '"') return string();
    if (token === "{") return object();
    if (token === "[") return array();
    const match = text.slice(index).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);
    if (match === null) fail("invalid value", index);
    index += match[0].length;
    return JSON.parse(match[0]);
  }

  function object() {
    index += 1;
    whitespace();
    const output = {};
    const keys = new Set();
    if (text[index] === "}") {
      index += 1;
      return output;
    }
    while (index < text.length) {
      if (text[index] !== '"') fail("object key must be a string", index);
      const key = string();
      if (keys.has(key)) throw new Error(`Malformed JSON: duplicate key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[index] !== ":") fail("missing colon", index);
      index += 1;
      output[key] = value();
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return output;
      }
      if (text[index] !== ",") fail("missing comma", index);
      index += 1;
      whitespace();
    }
    fail("unterminated object", index);
  }

  function array() {
    index += 1;
    whitespace();
    const output = [];
    if (text[index] === "]") {
      index += 1;
      return output;
    }
    while (index < text.length) {
      output.push(value());
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return output;
      }
      if (text[index] !== ",") fail("missing comma", index);
      index += 1;
      whitespace();
    }
    fail("unterminated array", index);
  }

  const parsed = value();
  whitespace();
  if (index !== text.length) fail("trailing non-whitespace", index);
  return parsed;
}
