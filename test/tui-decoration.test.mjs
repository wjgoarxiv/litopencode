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

// The LIT look over theme neutrals: the brand, the map ramp, the pills, the bar and the state colours
// are the LIT signature colours in every theme; text, muted text, fills and borders stay the theme's.
const hex = (value) => {
  const n = Number.parseInt(value.slice(1), 16);
  return rgba(n >> 16, (n >> 8) & 255, n & 255);
};
const theme = (tokens) => Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, hex(value)]));
const opencodeDark = theme({ primary: "#fab283", secondary: "#5c9cf5", accent: "#9d7cd8", info: "#56b6c2", warning: "#f5a742", success: "#7fd88f", error: "#e06c75", text: "#eeeeee", textMuted: "#808080", background: "#0a0a0a", backgroundPanel: "#141414", backgroundElement: "#1e1e1e", borderActive: "#606060", borderSubtle: "#3c3c3c" });
const tokyonight = theme({ primary: "#82aaff", secondary: "#c099ff", accent: "#ff966c", info: "#82aaff", warning: "#ff966c", success: "#c3e88d", error: "#ff757f", text: "#c8d3f5", textMuted: "#828bb8", background: "#1a1b26", backgroundPanel: "#1e2030", backgroundElement: "#222436", borderActive: "#9099b2", borderSubtle: "#545c7e" });
const opencodeLight = theme({ primary: "#3b7dd8", secondary: "#7b5bb6", accent: "#d68c27", info: "#318795", warning: "#d68c27", success: "#3d9a57", error: "#d1383d", text: "#1a1a1a", textMuted: "#8a8a8a", background: "#ffffff", backgroundPanel: "#fafafa", backgroundElement: "#f5f5f5", borderActive: "#a0a0a0", borderSubtle: "#d4d4d4" });
const signature = (palette) => ({ primary: palette.primary, secondary: palette.secondary, accent: palette.accent, info: palette.info, warning: palette.warning, success: palette.success, error: palette.error, fill: palette.fill, fillWarn: palette.fillWarn, onFill: palette.onFill });
const litDark = { primary: "#ff6337", secondary: "#ff2d95", accent: "#5fd7ff", info: "#5fd7ff", warning: "#ffaf3c", success: "#6bdb8f", error: "#ff5f5f", fill: "#5fd7ff", fillWarn: "#ffaf3c", onFill: "#0b0f14" };

test("dark themes take the LIT signature colours for the brand, map, pills, bar and states, and keep their own neutrals", () => {
  const dark = paletteFromTheme(opencodeDark, "dark");
  assert.deepEqual(signature(dark), litDark);
  assert.deepEqual([dark.text, dark.muted, dark.borderActive, dark.borderSubtle, dark.panel, dark.element], ["#eeeeee", "#808080", "#606060", "#3c3c3c", "#141414", "#1e1e1e"]);
  const tokyo = paletteFromTheme(tokyonight, "dark");
  assert.deepEqual(signature(tokyo), litDark);
  assert.notEqual(tokyo.accent, tokyo.warning, "tokyonight's accent equals its warning; the LIT accent never does");
  assert.deepEqual([tokyo.text, tokyo.muted, tokyo.borderSubtle, tokyo.panel], ["#c8d3f5", "#828bb8", "#545c7e", "#1e2030"]);
});

test("light themes keep the bright LIT fills with dark ink and deepen the text colours within the same hue", () => {
  const light = paletteFromTheme(opencodeLight, "light");
  assert.deepEqual(signature(light), { primary: "#e2521f", secondary: "#d81b78", accent: "#0a87b8", info: "#0a87b8", warning: "#b86e00", success: "#1f9d55", error: "#d93a3a", fill: "#5fd7ff", fillWarn: "#ffaf3c", onFill: "#0b0f14" });
  assert.deepEqual([light.text, light.muted, light.borderSubtle, light.panel], ["#1a1a1a", "#8a8a8a", "#d4d4d4", "#fafafa"]);
});

test("a transparent theme still draws LIT pills with dark ink, never ink taken from a missing background", () => {
  const clear = paletteFromTheme({ background: rgba(0, 0, 0, 0), backgroundPanel: rgba(0, 0, 0, 0) }, "dark");
  assert.equal(clear.onFill, "#0b0f14");
  assert.equal(clear.fill, "#5fd7ff");
});
