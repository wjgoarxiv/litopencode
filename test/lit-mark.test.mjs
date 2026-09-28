import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { test } from "node:test";
import { standard, banner, micro, lockup, colorize, markColorMode, supportsMarkGlyphs, terminalMark } from "../src/lit-mark.ts";

const fixtureBytes = await fs.readFile(new URL("./fixtures/lit-mark/ignition-b.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const utf8 = { LANG: "en_US.UTF-8", TERM: "xterm-256color" };
const ansi = /\u001b\[[0-9;]*m/gu;
const palette = {
  "#FF6337": { truecolor: "38;2;255;99;55", "256": "38;5;203" },
  "#D7F75B": { truecolor: "38;2;215;247;91", "256": "38;5;191" },
  "#F2EFDF": { truecolor: "38;2;242;239;223", "256": "38;5;230" }
};

test("the accepted Ignition B fixture has its independently pinned SHA-256", () => {
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec");
});

for (const [name, rows, width, height] of [["standard", standard, 22, 10], ["banner", banner, 44, 20], ["micro", micro, 16, 5]]) {
  test(`${name} preserves the accepted B rows, envelope, glyphs, and all per-cell colors`, () => {
    assert.equal(rows.length, height);
    assert.ok(rows.every((row) => row.length === width));
    assert.ok(rows.every((row) => /^[█▀▄▌▐▖▗▘▝▙▛▜▟▚▞ ]*$/u.test(row)));
    assert.deepEqual([...rows], fixture[name].map(({ text }) => text));
    for (const mode of ["truecolor", "256"]) {
      const colored = colorize([...rows], { mode });
      const usedColors = new Set();
      for (const [index, { text, colors }] of fixture[name].entries()) {
        assert.equal(colors.length, width);
        let expected = "";
        for (const [column, glyph] of [...text].entries()) {
          const hex = colors[column];
          assert.equal(hex === null, glyph === " ");
          if (hex === null) expected += glyph;
          else {
            assert.ok(Object.hasOwn(palette, hex));
            usedColors.add(hex);
            expected += `\u001b[${palette[hex][mode]}m${glyph}\u001b[0m`;
          }
        }
        assert.equal(colored[index], expected);
        assert.equal(colored[index].replace(ansi, ""), rows[index]);
      }
      assert.deepEqual([...usedColors].sort(), Object.keys(palette).sort());
      assert.doesNotMatch(colored.join("\n"), /\u001b\[(?:48;|38;5;(?:220|208|160|52)m)/u);
    }
  });
}

test("lockup keeps arbitrary labels separate from canonical mark color and padding", () => {
  for (const rows of [standard, banner, micro]) {
    const width = rows[0].length;
    const label = "custom · 제품 █";
    const locked = lockup(label, rows);
    const middle = Math.floor(rows.length / 2);
    assert.equal(locked.length, rows.length);
    assert.deepEqual(locked.map((row) => row.slice(0, width)), [...rows]);
    assert.equal(locked[middle].slice(width + 6), `  ${label}`);
    for (const mode of ["truecolor", "256"]) {
      const colored = colorize(locked, { mode });
      assert.deepEqual(colored.map((row) => row.replace(ansi, "")), locked);
      assert.ok(colored[middle].endsWith(`        ${label}`));
    }
  }
  assert.doesNotMatch(lockup("bad\n\u001bname").join("\n"), /\u001b/u);
});

test("none color mode preserves exact rows without escapes or mutation", () => {
  for (const rows of [standard, banner, micro, lockup("opencode")]) {
    const before = [...rows];
    assert.deepEqual(colorize(rows, { mode: "none" }), before);
    assert.deepEqual(rows, before);
    assert.doesNotMatch(colorize(rows, { mode: "none" }).join("\n"), /\u001b/);
  }
});

test("custom rows preserve glyphs in ivory and the former shadow option cannot change B", () => {
  assert.deepEqual(colorize(["█▓ label"], { mode: "truecolor" }), ["\u001b[38;2;242;239;223m█\u001b[0m\u001b[38;2;242;239;223m▓\u001b[0m label"]);
  assert.deepEqual(colorize(standard, { mode: "truecolor", shadow: "#000000" }), colorize(standard, { mode: "truecolor" }));
  assert.throws(() => colorize(standard, { mode: "truecolor", shadow: "bad\u001b" }), /hex color/);
});

test("terminal capability policy suppresses ANSI for NO_COLOR, non-TTY, JSON and CI", () => {
  assert.equal(markColorMode({ env: { ...utf8, COLORTERM: "truecolor" }, isTTY: true, argv: [] }), "truecolor");
  assert.equal(markColorMode({ env: utf8, isTTY: true, argv: [] }), "256");
  for (const options of [
    { env: { ...utf8, NO_COLOR: "" }, isTTY: true },
    { env: utf8, isTTY: false },
    { env: utf8, isTTY: true, argv: ["--json"] },
    { env: { ...utf8, CI: "" }, isTTY: true }
  ]) {
    assert.equal(markColorMode(options), "none");
    assert.deepEqual(terminalMark(standard, options), standard);
  }
});

test("locale precedence and dumb terminals select the plain LIT wordmark", () => {
  for (const env of [{}, { LANG: "C" }, { ...utf8, LC_ALL: "C" }, { ...utf8, LC_CTYPE: "POSIX" }, { ...utf8, TERM: "dumb" }]) {
    assert.equal(supportsMarkGlyphs(env), false);
    assert.equal(markColorMode({ env, isTTY: true, argv: [] }), "none");
    assert.deepEqual(terminalMark(banner, { env, isTTY: true }), ["LIT"]);
  }
  assert.equal(supportsMarkGlyphs({ LANG: "C", LC_ALL: "C.UTF-8" }), true);
});

test("English and Korean README heroes use the version-free banner lockup", async () => {
  for (const file of ["README.md", "README-Ko-KR.md", "README-npm.md", "README-npm-Ko-KR.md"]) {
    const text = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const heroes = [...text.matchAll(/<details>\n<summary>(?:Copy ASCII logo|ASCII 로고 복사)<\/summary>\n\n```text\n([\s\S]*?)\n```\n\n<\/details>/gu)];
    assert.equal(heroes.length, 1, `${file} must have one explicitly labeled copyable ASCII banner`);
    const hero = heroes[0][1];
    assert.equal(hero, lockup("litopencode", banner).map((row) => row.trimEnd()).join("\n"));
    assert.doesNotMatch(hero, /╔|╚|v\d/u);
  }
});
