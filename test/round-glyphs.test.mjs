import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fontFolders, iconFontInstalled, isIconFontFile, roundCaps } from "../src/round-glyphs.ts";

const never = () => assert.fail("the fonts are not looked at");

test("the explicit setting wins over everything", () => {
  for (const value of ["round", "nerd", "ROUND"]) assert.equal(roundCaps({ LITOPENCODE_GLYPHS: value, SSH_CONNECTION: "a b c d" }, never), true, value);
  for (const env of [{}, { WT_SESSION: "x" }, { TERM_PROGRAM: "vscode" }, { TERM: "xterm-kitty" }]) assert.equal(roundCaps({ ...env, LITOPENCODE_GLYPHS: "basic" }, never), false);
  assert.equal(roundCaps({ LITOPENCODE_GLYPHS: "unknown" }, () => true), true, "an unknown value is no setting");
  assert.equal(roundCaps({ LITOPENCODE_GLYPHS: "" }, () => false), false);
});

test("a terminal that draws the caps itself says yes, over SSH too", () => {
  for (const env of [{ WT_SESSION: "x" }, { TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "WezTerm" }, { TERM_PROGRAM: "ghostty" }, { TERM: "xterm-kitty" }, { KITTY_WINDOW_ID: "1" }]) {
    assert.equal(roundCaps(env, never), true, JSON.stringify(env));
    assert.equal(roundCaps({ ...env, SSH_CONNECTION: "a b c d" }, never), true, JSON.stringify(env));
  }
});

test("elsewhere an icon font on this machine decides, but never over SSH", () => {
  for (const env of [{}, { WT_SESSION: "" }, { TERM_PROGRAM: "Apple_Terminal" }, { TERM_PROGRAM: "tmux" }, { TERM: "xterm-256color" }]) {
    assert.equal(roundCaps(env, () => true), true, JSON.stringify(env));
    assert.equal(roundCaps(env, () => false), false, JSON.stringify(env));
  }
  assert.equal(roundCaps({ SSH_CONNECTION: "a b c d" }, never), false);
});

test("an icon font is known by its file name", () => {
  for (const name of ["JetBrainsMonoNerdFont-Regular.ttf", "MesloLGS NF Bold.ttf", "Hack Nerd Font Mono.otf", "CaskaydiaCoveNFM-Regular.ttf", "nerd-fonts.ttc"]) assert.equal(isIconFontFile(name), true, name);
  for (const name of ["JetBrainsMono-Regular.ttf", "NFL.ttf", "INFO.ttf", "JetBrainsMonoNerdFont.zip", "Menlo.ttc", "NerdFont.txt"]) assert.equal(isIconFontFile(name), false, name);
});

test("the look for a font is bounded, opens no file and follows no link", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-fonts-"));
  try {
    const font = "HackNerdFont-Regular.ttf";
    assert.equal(iconFontInstalled([path.join(root, "absent")]), false);
    fs.mkdirSync(path.join(root, "a", "b", "c", "d", "e"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c", "d", "e", font), "");
    assert.equal(iconFontInstalled([root]), false, "too deep");
    fs.writeFileSync(path.join(root, "a", "b", font), "", { mode: 0o000 });
    assert.equal(iconFontInstalled([root]), true, "an unreadable file still has a name");
    assert.equal(iconFontInstalled([root], 2), false, "the entry limit stops the look");
    const links = path.join(root, "links");
    fs.mkdirSync(links);
    try {
      fs.symlinkSync(path.join(root, "a"), path.join(links, "fonts"));
    } catch {
      return;
    }
    assert.equal(iconFontInstalled([links]), false, "a linked folder is not followed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("each platform's own font folders are searched", () => {
  assert.deepEqual(fontFolders({ HOME: "/u" }, "darwin"), [path.join("/u", "Library", "Fonts"), "/Library/Fonts"]);
  assert.deepEqual(fontFolders({}, "win32"), []);
  assert.equal(fontFolders({ LOCALAPPDATA: "/l", WINDIR: "/w" }, "win32").length, 2);
  assert.ok(fontFolders({ HOME: "/u" }, "linux").includes(path.join("/u", ".local", "share", "fonts")));
  assert.ok(fontFolders({ HOME: "/u", XDG_DATA_HOME: "/x" }, "linux").includes(path.join("/x", "fonts")));
});
