import assert from "node:assert/strict";
import { test } from "node:test";
import { cardWordmark, createCardInstallTui } from "../src/cli/install-tui.ts";
import { extensionsNoticeLines } from "../src/extensions-notice.ts";
import { cellWidth } from "../src/tui/mission-text.ts";
import { fakeTerminal, keys, pause, strip, utf8 } from "../test-support/card-terminal.mjs";

// The round and the square form of the installer cards: the same rows and columns, only the cap cells differ.
const list = { title: "Permissions", note: "Sets how much the agents may do.", choices: [{ label: "Safe", detail: "Do not relax" }, { label: "Balanced", detail: "Routine work runs" }, { label: "YOLO", detail: "lit-plan remains deny-only" }], initial: 0 };
const many = { title: "Helper model", note: "Pick one.", choices: Array.from({ length: 60 }, (_, index) => ({ label: `team/coder-${index}` })), initial: 3 };
const yesNo = { title: "LitFamily block", note: "Adds the short block; No leaves the file alone.", initial: true, yes: "add", no: "off" };
const route = { title: "Model route", note: "Enter keeps this route; nothing is written before the install starts.", fields: [{ label: "Provider", value: "openai" }, { label: "Lead", value: "gpt-6-astra · xhigh" }, { label: "Writes", value: "~/.config/opencode/litopencode.json  (managed keys only)" }], done: "gpt-6-astra · xhigh" };
const typed = { title: "Lead model", note: "Type the model as provider/model.", example: "my-gateway/deepseek-chat", attempts: 3, exhausted: "no", read: () => ({ problem: "OpenCode does not list that model." }) };
const makers = {
  list: (cards) => cards.choose(list), filter: (cards) => cards.choose(many), confirm: (cards) => cards.confirm(yesNo),
  no: (cards) => cards.confirm({ ...yesNo, initial: false }), proceed: (cards) => cards.proceed(route), typed: (cards) => cards.type(typed)
};
const caps = /[]/gu;
async function shown(make, options) {
  const term = fakeTerminal(options);
  term.cards.expect(5);
  const answer = make(term.cards);
  await pause(4);
  const lines = [...term.lines()];
  while (lines.at(-1) === "") lines.pop();
  const written = term.written();
  answer.catch(() => {});
  term.stdin.write(keys.ctrlC);
  await pause(2);
  return { lines, written };
}

/** The cells of one written row as [character, background], from its colour codes. */
function cellsOf(row) {
  const out = [];
  let bg;
  for (const part of row.split(/(\u001b\[[0-9;?]*[A-Za-z])/u)) {
    const code = /^\u001b\[([0-9;]*)m$/u.exec(part);
    if (code) {
      if (code[1] === "0") bg = undefined;
      const back = /48;2;(\d+;\d+;\d+)/u.exec(code[1]);
      if (back) bg = back[1];
    } else if (!part.startsWith("\u001b")) for (const char of part) out.push([char, bg]);
  }
  return out;
}

test("every card in every window size: the same text in both forms, edges in column, the sentence and the stop key kept", async () => {
  for (const [name, make] of Object.entries(makers)) {
    for (const cols of [40, 60, 80, 100, 120]) {
      for (const rows of [12, 16, 24, 60]) {
        const round = await shown(make, { cols, rows, caps: true });
        const square = await shown(make, { cols, rows });
        const label = `${name} ${cols}x${rows}`;
        assert.deepEqual(round.lines.map((line) => line.replace(caps, " ")), square.lines, label);
        assert.match(round.written, caps, label);
        assert.doesNotMatch(round.written, /[░▒▓▯▌▐]|\[[▉░]/u, label);
        assert.doesNotMatch(square.written, caps, label);
        const card = square.lines.filter((line) => /^ [│╭╰]/u.test(line));
        for (const line of card) assert.equal(cellWidth(line), 1 + Math.min(cols - 2, 100), `${label}: ${line}`);
        const height = square.lines.length - square.lines.findLastIndex((line) => line.startsWith(" ╭─  LIT"));
        assert.ok(height <= rows - 1, `${label}: ${height} rows`);
        assert.match(square.lines.join(" "), /Sets how|Pick one|Adds the|Enter keeps|Type the/u, label);
        assert.match(square.lines.join(" "), /Ctrl\+C stop/u, label);
      }
    }
  }
});

test("in the round form every fill has both caps; a filled cell never touches a plain one", async () => {
  for (const make of Object.values(makers)) {
    const { written } = await shown(make, { caps: true });
    for (const row of written.split("\r\n")) {
      const cells = cellsOf(row);
      cells.forEach(([char, bg], index) => {
        if (bg === undefined) return;
        if (cells[index - 1]?.[1] === undefined) assert.equal(cells[index - 1]?.[0], "", strip(row));
        if (cells[index + 1]?.[1] === undefined) assert.equal(cells[index + 1]?.[0], "", `${char} in ${strip(row)}`);
      });
    }
  }
});

test("caps need truecolor, UTF-8 and a dark terminal, whatever the fonts", async () => {
  for (const options of [{ depth: 8 }, { depth: 4 }, { env: { ...utf8, NO_COLOR: "1" } }, { env: { LC_ALL: "C", TERM: "xterm" } }, { env: { ...utf8, COLORFGBG: "0;15" } }, { env: { ...utf8, LITOPENCODE_GLYPHS: "basic" }, caps: null }]) {
    for (const make of Object.values(makers)) assert.doesNotMatch((await shown(make, { caps: true, ...options })).written, caps, JSON.stringify(options));
  }
  for (const options of [{ env: { ...utf8, COLORFGBG: "15;0" } }, { env: { ...utf8, LITOPENCODE_GLYPHS: "round" }, caps: null }]) assert.match((await shown(makers.list, { caps: true, ...options })).written, caps);
});

test("the title edge, the list row, the buttons and the facts stand in their columns", async () => {
  const square = async (make, options) => (await shown(make, options)).lines;
  assert.match((await square(makers.list))[1], /^ ╭─ {2}LIT 1\/5 {2}· Permissions ─+╮$/u);
  const rows = await square(makers.list);
  assert.match(rows.find((line) => line.includes("❯")), /^ │ {2}❯ 0 Safe {6}Do not relax {2}default +│$/u);
  const yes = await square(makers.confirm);
  const at = yes.findIndex((line) => line.includes("╭───────────"));
  assert.deepEqual(yes.slice(5, 8).map((line) => line.slice(0, 48).trimEnd()), [
    ` │ ╭${"─".repeat(19)}╮  ╭${"─".repeat(19)}╮`, " │ │  ❯ Yes (default)  │  │    No             │", ` │ ╰${"─".repeat(19)}╯  ╰${"─".repeat(19)}╯`
  ], `${at}\n${yes.join("\n")}`);
  const facts = await square(makers.proceed);
  for (const field of route.fields) assert.equal(facts.find((line) => line.includes(`· ${field.label}`)).indexOf(field.value.slice(0, 6)), 24);
  assert.ok(facts.findIndex((line) => line.includes("Enter keeps")) < facts.findIndex((line) => line.includes("· Provider")));
  assert.match(facts.at(-2), /Enter = Continue {3}Ctrl\+C stop, nothing written yet/u);
  assert.match((await square(makers.confirm, { cols: 44 })).join("\n"), /❯ Yes default/u);
  assert.match((await square(makers.filter)).at(-2), /↑ ↓ move {3}Enter choose {3}Esc clear filter {3}Ctrl\+C stop/u);
});

test("without colour the lit button has a double frame, and in ASCII a # frame", async () => {
  assert.match((await shown(makers.confirm, { env: { ...utf8, NO_COLOR: "1" } })).lines.join("\n"), /\[LIT 1\/5\] · LitFamily block[\s\S]*╔═+╗ {2}╭─+╮[\s\S]*║ {2}❯ Yes \(default\) {2}║/u);
  assert.match((await shown(makers.confirm, { env: { LC_ALL: "C", TERM: "xterm" } })).lines.join("\n"), /#=+# {2}\+-+\+[\s\S]*# {2}> Yes \(default\) {2}#/u);
  assert.match((await shown(makers.list, { env: { ...utf8, NO_COLOR: "1" } })).lines.join("\n"), /❯ 0 Safe .*\(default\)/u);
});

test("one blank row between blocks, never two, and folded values at column 24", async () => {
  const term = fakeTerminal({ rows: 60 });
  const progress = createCardInstallTui({ stdin: term.stdin, stdout: term.stdout, env: utf8, animate: false, settleMs: 1, proc: term.proc, caps: false });
  const { cards } = progress;
  cards.banner(cardWordmark("@litfamily/litopencode@1.0.0", { columns: 100, rows: 30 }));
  cards.intro("Installs into ~/x. OpenCode is set up only after your answers.");
  const blanks = () => assert.doesNotMatch(term.text().replace(/\n+$/u, ""), /\n\n\n/u, term.text());
  cards.expect(2);
  const first = cards.choose(list);
  await pause();
  blanks();
  await term.press(keys.enter);
  await first;
  cards.warn("A saved route is replaced.");
  const second = cards.confirm(yesNo);
  await pause();
  blanks();
  assert.match(term.text(), /LIT 2\/2/u);
  await term.press("y");
  await second;
  await progress.start("@litfamily/litopencode@1.0.0");
  assert.match(term.text(), /LIT {2}· Installing LitOpenCode 1\.0\.0 ─+╮\n │ +│\n │ · Package {12}Resolve/u);
  for (const step of ["Resolve package", "Read OpenCode config", "Write litopencode.json", "Register plugin", "Verify install"]) await progress.run(step, async () => blanks());
  await progress.complete();
  cards.panel("LitOpenCode 1.0.0 is installed", [{ head: "Installed", fields: [{ label: "Plugin", value: "x" }] }, { head: "Settings", fields: [{ label: "Permissions", value: "Safe" }] }, { head: "Next", fields: [{ label: "Start", value: "Restart OpenCode" }] }]);
  const [heading, ...lines] = extensionsNoticeLines([], false, cards.textWidth);
  cards.notice(heading, lines);
  blanks();
  const text = term.text();
  assert.match(text, /\n ✓ Permissions {10}Safe\n ! A saved route is replaced\.\n ✓ LitFamily block {6}add\n ✓ Install steps {8}5 of 5 checked\n\n ╭─/u);
  assert.match(text, /│ +│\n │ Installed +│\n │ ✓ Plugin {13}x +│\n │ +│\n │ Settings +│\n │ · Permissions {8}Safe +│\n │ +│\n │ Next +│\n │ · Start {14}Restart OpenCode +│\n ╰/u);
  assert.match(text, /╯\n\n LitFamily extensions\n {3}LitOpenCode's core[\s\S]*\n {5}litopencode extensions list\n/u);
});

test("a failed step leaves the work card and adds a red card with stage, reason and next step", async () => {
  const term = fakeTerminal({ rows: 60 });
  const progress = createCardInstallTui({ stdin: term.stdin, stdout: term.stdout, env: utf8, animate: false, settleMs: 1, proc: term.proc, caps: false });
  await progress.start("@litfamily/litopencode@1.0.0");
  await assert.rejects(progress.run("Read OpenCode config", async () => { throw new Error("the file is read only"); }));
  await progress.fail("Installer stopped before completion.", "the file is read only");
  assert.match(term.text(), /✗ Host config[\s\S]*╯\n\n ╭─ {2}LIT {2}· INSTALL STOPPED[\s\S]*✗ Stage {14}Host config[\s\S]*✗ Reason {13}the file is read only[\s\S]*· Next {15}Fix the reason/u);
  assert.match(term.written().split("INSTALL STOPPED")[1], /38;2;255;85;119/u);
  assert.deepEqual(term.raw, [true, false]);
});

test("the mark is centred over the cards and sized to the window's height", () => {
  const height = (rows, columns = 120) => cardWordmark("@litfamily/litopencode@1.0.0", { columns, rows }).length;
  assert.ok(height(60) > height(40) && height(40) > height(24), [height(60), height(40), height(24)].join(" "));
  assert.ok(height(60, 50) <= height(40), "a narrow window takes a narrower mark");
  const term = fakeTerminal();
  term.cards.banner(["x".repeat(20)]);
  assert.equal(term.lines()[1].indexOf("x"), 1 + Math.floor((98 - 20) / 2));
});
