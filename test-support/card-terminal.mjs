import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createInstallCards } from "../src/cli/install-cards.ts";

// A stand-in terminal for the installer cards, shared by their tests.
export const utf8 = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
export const strip = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "");
export const keys = { up: "\u001b[A", down: "\u001b[B", right: "\u001b[C", left: "\u001b[D", pageDown: "\u001b[6~", end: "\u001b[F", enter: "\r", tab: "\t", back: "\u007f", esc: "\u001b", ctrlC: "\u0003", ctrlD: "\u0004", ctrlU: "\u0015", ctrlZ: "\u001a" };
export const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

/** A terminal that keeps what is on screen: cursor up, erase below, erase line and plain rows are all the cards use. */
export function fakeTerminal({ cols = 100, rows = 40, env = utf8, depth = 24, now, resizes = false, caps = false } = {}) {
  const stdin = new PassThrough();
  const raw = [];
  Object.assign(stdin, { isTTY: true, setRawMode: (mode) => raw.push(mode) });
  const stdout = new EventEmitter();
  const screen = [""];
  let at = 0;
  let written = "";
  Object.assign(stdout, {
    isTTY: true, columns: cols, rows, getColorDepth: () => depth,
    write(text) {
      written += text;
      for (const part of text.split(/(\u001b\[\d*A|\u001b\[J|\u001b\[K|\r|\n)/u)) {
        const rise = /^\u001b\[(\d*)A$/u.exec(part);
        if (rise) at -= Number(rise[1] || 1);
        else if (part === "\u001b[J") screen.length = at;
        else if (part === "\n") at += 1;
        else if (part !== "" && part !== "\r" && part !== "\u001b[K") screen[at] = part;
        // This screen does not re-wrap old rows as a real one may, so after a resize the cursor stops at the top.
        if (resizes) at = Math.max(0, at);
        assert.ok(at >= 0, "the cursor never leaves the top");
        while (screen.length <= at) screen.push("");
      }
      return true;
    }
  });
  const proc = Object.assign(new EventEmitter(), { pid: 4242, platform: "darwin", kills: [], kill(pid, signal) { this.kills.push([pid, signal]); return true; } });
  const cards = createInstallCards({ stdin, stdout, env, animate: false, settleMs: 1, proc, caps, ...(now === undefined ? {} : { now }) });
  return {
    cards, stdin, stdout, proc, raw,
    written: () => written,
    text: () => screen.map(strip).join("\n"),
    lines: () => screen.map(strip),
    async press(...presses) {
      await pause();
      for (const key of presses) { stdin.write(key); await pause(key === keys.esc ? 560 : 8); }
    }
  };
}
