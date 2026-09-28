const borderConnections = Object.freeze({
  "┌": "RD",
  "┐": "LD",
  "└": "RU",
  "┘": "LU",
  "├": "RUD",
  "┤": "LUD",
  "┬": "LRD",
  "┴": "LRU",
  "┼": "LRUD",
  "─": "LR",
  "│": "UD"
});
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

function isWide(codePoint) {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function graphemeWidth(text, ambiguousWidth) {
  if (/^\p{Mark}+$/u.test(text)) return 0;
  if (text.includes("\u200d") || /\p{Extended_Pictographic}/u.test(text)) return 2;
  const first = text.codePointAt(0);
  if (first !== undefined && isWide(first)) return 2;
  if (ambiguousWidth === 2 && /[·§±×÷α-ωΑ-Ω]/u.test(text)) return 2;
  return 1;
}

function consumeStringControl(text, start) {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\u0007" || text[index] === "\u009c") return index + 1;
    if (text[index] === "\u001b" && text[index + 1] === "\\") return index + 2;
  }
  return text.length;
}

function consumeCsi(text, start) {
  for (let index = start; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return text.length;
}

function sanitize(text) {
  let output = "";
  for (let index = 0; index < text.length;) {
    const code = text.charCodeAt(index);
    if (text[index] === "\u001b") {
      const next = text[index + 1];
      if (next === "]" || next === "P" || next === "^" || next === "_" || next === "X") {
        index = consumeStringControl(text, index + 2);
      } else if (next === "[") {
        index = consumeCsi(text, index + 2);
      } else {
        index += Math.min(2, text.length - index);
      }
      continue;
    }
    if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
      index = consumeStringControl(text, index + 1);
      continue;
    }
    if (code === 0x9b) {
      index = consumeCsi(text, index + 1);
      continue;
    }
    if ((code >= 0 && code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f)) {
      index += 1;
      continue;
    }
    output += text[index];
    index += 1;
  }
  return output;
}

function inspectRow(text, ambiguousWidth) {
  const graphemes = [...segmenter.segment(text)].map(({ segment }) => ({
    text: segment,
    width: graphemeWidth(segment, ambiguousWidth)
  }));
  return { graphemes, text, width: graphemes.reduce((total, item) => total + item.width, 0) };
}

function borderFindings(rows) {
  const grid = rows.map((row) => {
    const cells = new Map();
    let column = 0;
    for (const grapheme of row.graphemes) {
      if (borderConnections[grapheme.text]) cells.set(column, grapheme.text);
      column += grapheme.width;
    }
    return cells;
  });
  const directions = Object.freeze({
    L: [0, -1, "R"],
    R: [0, 1, "L"],
    U: [-1, 0, "D"],
    D: [1, 0, "U"]
  });
  const broken = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (const [column, character] of grid[row]) {
      const connections = borderConnections[character];
      for (const direction of connections) {
        const [dr, dc, opposite] = directions[direction];
        const neighbor = grid[row + dr]?.get(column + dc);
        if (!(borderConnections[neighbor]?.includes(opposite))) {
          broken.push({ column, direction, row });
        }
      }
    }
  }
  const bordered = rows.filter((_, index) => grid[index].size > 0);
  const widthMismatch = bordered.length > 0 && bordered.some((row) => row.width !== bordered[0].width);
  if (broken.length === 0 && !widthMismatch) return [];
  return [{
    code: "TUI_BORDER_TOPOLOGY_BROKEN",
    evidence: { broken_edges: broken.slice(0, 100), width_mismatch: widthMismatch },
    severity: "high"
  }];
}

export function inspectTui(text, { ambiguousWidth = 1 } = {}) {
  if (typeof text !== "string") throw new TypeError("TUI input must be a string");
  if (ambiguousWidth !== 1 && ambiguousWidth !== 2) throw new Error("ambiguousWidth must be 1 or 2");
  const sanitized = sanitize(text);
  const rows = sanitized.split("\n").map((row) => inspectRow(row, ambiguousWidth));
  return {
    controlSequencesInert: !/[\u001b\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(sanitized),
    findings: borderFindings(rows),
    rows,
    sanitized
  };
}
