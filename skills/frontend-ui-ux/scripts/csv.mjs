export function parseRfc4180(text, label = "CSV") {
  if (typeof text !== "string") throw new TypeError(`${label} must be UTF-8 text`);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        afterQuote = false;
      } else {
        throw new Error(`${label}: unexpected character after closing quote`);
      }
      continue;
    }
    if (character === '"') {
      if (field.length === 0) quoted = true;
      else field += character;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(`${label}: unterminated quoted field`);
  if (afterQuote || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) throw new Error(`${label}: empty CSV`);
  const width = rows[0].length;
  if (rows.some((candidate) => candidate.length !== width)) throw new Error(`${label}: inconsistent row width`);
  return rows;
}
