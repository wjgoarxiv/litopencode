const modelShapingCharacters = /[`~\u007f-\u009f\u2028\u2029\ufffe\uffff]|\p{Cf}/gu;
const xmlInvalidCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu;

function visibleUtf16(character: string): string {
  return Array.from(
    { length: character.length },
    (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`
  ).join("");
}

// JSON handles C0, quotes, and backslashes. The post-pass makes every remaining model-shaping
// character visible while preserving supplementary code points as complete UTF-16 surrogate pairs.
export function serializeInertData(value: string): string {
  return JSON.stringify(value).replace(modelShapingCharacters, visibleUtf16);
}

export function encodeXmlInvalidCharacters(value: string): string {
  return value.replace(xmlInvalidCharacters, visibleUtf16);
}
