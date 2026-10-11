import assert from "node:assert/strict";
import { test } from "node:test";
import * as text from "../src/tui/mission-text.ts";

const { paletteFromTheme } = text;
const chipBudget = (input) => text.chipBudget(input);

// U7 regressions found while designing the decoration pass: transparent theme tokens and a chip
// budget that assumed the sidebar was open whenever the terminal was wide.
const rgba = (r, g, b, a = 255) => ({ toInts: () => [r, g, b, a] });

test("a transparent theme background is no background, and fills mix against backgroundPanel instead of black", () => {
  const palette = paletteFromTheme({
    background: rgba(0, 0, 0, 0),
    backgroundPanel: rgba(30, 30, 46, 255),
    backgroundElement: rgba(0, 0, 0, 0),
    success: rgba(166, 227, 161)
  });
  assert.equal(palette.background, undefined);
  assert.equal(palette.panel, "#1e1e2e");
  assert.equal(palette.element, undefined);
  assert.equal(palette.mixBase, "#1e1e2e");
  const all = paletteFromTheme({ background: rgba(0, 0, 0, 0), backgroundPanel: rgba(0, 0, 0, 0) });
  assert.equal(all.panel, undefined);
  assert.notEqual(all.mixBase, "#000000");
});

test("the chip budget follows the real sidebar state instead of assuming it is open on wide terminals", () => {
  assert.equal(chipBudget({ width: 168, sidebar: "auto", child: false }), 80);
  assert.equal(chipBudget({ width: 168, sidebar: "hide", child: false }), 122);
  assert.equal(chipBudget({ width: 168, sidebar: "auto", child: true }), 122);
  assert.equal(chipBudget({ width: 100, sidebar: "auto", child: false }), 54);
  // Unknown sidebar state: assume it is open when it could be, so the chip never overflows.
  assert.equal(chipBudget({ width: 168, sidebar: undefined, child: false }), 80);
});
