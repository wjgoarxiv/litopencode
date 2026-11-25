import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsTerminal } from "../src/cli/install-cards.ts";
import { fakeTerminal, keys, pause, strip, utf8 } from "../test-support/card-terminal.mjs";
import { cellWidth } from "../src/tui/mission-text.ts";

const models = (count) => Array.from({ length: count }, (_, index) => ({ label: `team-${String(index % 20).padStart(2, "0")}/coder-${String(100 + index)}b` }));
const list = { title: "Permissions", note: "Sets how much the agents may do.", choices: [{ label: "Safe", detail: "Do not relax" }, { label: "Balanced", detail: "Routine work runs" }, { label: "YOLO", detail: "lit-plan remains deny-only" }], initial: 0 };
const yesNo = { title: "LitFamily block", note: "Adds the block; No leaves the file alone.", initial: true, yes: "add", no: "off" };

test("cards need two TTYs, raw mode, room, and no CI, dumb terminal or prompt hook", () => {
  const stream = { isTTY: true, columns: 80, rows: 24 };
  const input = { isTTY: true, setRawMode() {} };
  const ok = (over = {}) => cardsTerminal({ stdin: input, stdout: stream, env: utf8, ...over });
  assert.equal(ok(), true);
  assert.equal(ok({ env: { ...utf8, NO_COLOR: "1" } }), true, "NO_COLOR keeps the cards and drops the colour");
  assert.equal(ok({ stdin: { ...input, isTTY: false } }), false);
  assert.equal(ok({ stdin: { isTTY: true } }), false, "no raw mode");
  assert.equal(ok({ stdout: { ...stream, isTTY: undefined } }), false);
  for (const env of [{ CI: "" }, { CI: "1" }, { TERM: "dumb" }, { LITOPENCODE_AGENT_FILE_PROMPT: "0" }]) assert.equal(ok({ env: { ...utf8, ...env } }), false, JSON.stringify(env));
  assert.equal(ok({ stdout: { ...stream, columns: 39 } }), false);
  assert.equal(ok({ stdout: { ...stream, rows: 11 } }), false);
  assert.equal(ok({ stdout: { ...stream, rows: 12 } }), true);
  assert.equal(ok({ stdout: { isTTY: true } }), true, "an unknown size counts as 80 by 24");
});

test("a short list: arrows, j and k wrap, a digit jumps without answering, Enter takes the highlighted row", async () => {
  for (const [presses, want] of [
    [[keys.enter], 0], [[keys.down, keys.enter], 1], [[keys.up, keys.enter], 2], [["j", "j", keys.enter], 2],
    [["j", "k", keys.enter], 0], [["2", keys.enter], 2], [["9", keys.enter], 0], [[keys.end, keys.enter], 2], [["x", " ", keys.enter], 0]
  ]) {
    const term = fakeTerminal();
    const answer = term.cards.choose(list);
    await term.press(...presses);
    assert.equal(await answer, want, JSON.stringify(presses));
    assert.deepEqual(term.lines().filter((line) => line !== ""), [` ✓ Permissions          ${list.choices[want].label}`], "the card folds to one line");
  }
});

test("the starting row is highlighted and named, and a saved choice is called current", async () => {
  for (const [mark, word] of [[undefined, "default"], ["current", "current"]]) {
    const term = fakeTerminal();
    const answer = term.cards.choose({ ...list, initial: 1, mark });
    await pause();
    const rows = term.lines();
    assert.match(rows.find((row) => row.includes("❯")), new RegExp(`❯ 1 Balanced  Routine work runs  ${word} `, "u"));
    assert.equal(rows.filter((row) => row.includes(word)).length, 1);
    await term.press(keys.enter);
    assert.equal(await answer, 1);
  }
});

test("a long list scrolls in a fixed window and typing filters it", async () => {
  const term = fakeTerminal();
  const answer = term.cards.choose({ title: "Helper model", note: "Pick one.", choices: models(260), initial: 3 });
  await pause();
  assert.match(term.text(), /type to filter +260 to choose from/u);
  const height = term.lines().length;
  await term.press("1", "2", "j");
  assert.match(term.text(), /Filter {2}12j█ +0 of 260/u, "digits and letters go into the filter, never jump");
  await term.press(keys.enter);
  assert.match(term.text(), /0 of 260/u, "Enter on no match answers nothing");
  await term.press(keys.back);
  assert.match(term.text(), /❯ team-12\/coder-112b/u);
  await term.press(" ", "0", "5", "/");
  assert.match(term.text(), /Filter {2}12 05\/█ +1 of 260/u, "every word must match");
  assert.equal(term.lines().length, height, "the card keeps its height while the matches change");
  await term.press(keys.esc);
  assert.match(term.text(), /260 to choose from/u, "Esc clears the filter and answers nothing");
  await term.press("C", "O", "D", "E", "R", "-", "3", "5", "9", keys.enter);
  assert.equal(await answer, 259);
  assert.match(term.text(), /✓ Helper model +team-19\/coder-359b/u);
});

test("paging stops at the ends, and a pinned row stays whatever is typed", async () => {
  const term = fakeTerminal();
  const choices = [...models(40), { label: "Type provider/model", sticky: true }];
  const answer = term.cards.choose({ title: "Provider", note: "Pick one.", choices, initial: 0 });
  await term.press(keys.pageDown, keys.pageDown, keys.pageDown, keys.pageDown);
  assert.match(term.text(), /❯ Type provider\/model/u);
  await term.press("z", "z");
  assert.match(term.text(), /❯ Type provider\/model[\s\S]*0 of 40|0 of 40[\s\S]*❯ Type provider\/model/u);
  await term.press(keys.ctrlU, "1", "0", "5");
  assert.match(term.text(), /❯ team-05\/coder-105b/u, "a real match takes the highlight from the pinned row");
  await term.press(keys.enter);
  assert.equal(await answer, 5);
});

test("yes or no: letters answer, arrows and Tab switch, Enter takes the highlighted button, Esc does nothing", async () => {
  for (const [initial, presses, want] of [
    [true, [keys.enter], true], [false, [keys.enter], false], [true, ["n"], false], [false, ["Y"], true], [true, [keys.right, keys.enter], false],
    [true, [keys.tab, keys.tab, keys.enter], true], [false, [keys.left, keys.enter], true], [true, [keys.esc, keys.enter], true], [true, ["x", "q", keys.enter], true]
  ]) {
    const term = fakeTerminal();
    const answer = term.cards.confirm({ ...yesNo, initial });
    await pause();
    assert.match(term.text(), initial ? /block \[Y\/n\][\s\S]*❯ Yes \(default\)[\s\S]*Enter = Yes/u : /block \[y\/N\][\s\S]*❯ No \(default\)[\s\S]*Enter = No/u);
    await term.press(...presses);
    assert.equal(await answer, want, JSON.stringify(presses));
    assert.match(term.text(), want ? /✓ LitFamily block +add/u : /✓ LitFamily block +off/u);
  }
});

test("keys typed before a card shows are dropped, and the Enter after a letter does not answer the next card", async () => {
  let clock = 0;
  const term = fakeTerminal({ now: () => clock });
  term.stdin.write("n");
  const first = term.cards.confirm(yesNo);
  await term.press("y");
  assert.equal(await first, true, "the early n was not this card's answer");
  const second = term.cards.confirm({ ...yesNo, title: "Next" });
  await term.press(keys.enter);
  assert.match(term.text(), /Next \[Y\/n\]/u, "still asking");
  clock = 1000;
  await term.press(keys.right, keys.enter);
  assert.equal(await second, false);
});

test("Ctrl+C and Ctrl+D abort with the plain prompt's message, restore the terminal and fold the card", async () => {
  for (const [key, message] of [[keys.ctrlC, "Aborted with Ctrl+C"], [keys.ctrlD, "Aborted with Ctrl+D"]]) {
    for (const start of [(cards) => cards.choose(list), (cards) => cards.confirm(yesNo), (cards) => cards.proceed({ title: "Model route", note: "n", fields: [{ label: "Lead", value: "a" }], done: "a" }), (cards) => cards.type({ title: "Lead model", note: "n", example: "a/b", attempts: 3, exhausted: "no", read: () => ({ problem: "no" }) })]) {
      const term = fakeTerminal();
      const answer = start(term.cards);
      const settled = assert.rejects(answer, { message });
      await term.press(key);
      await settled;
      assert.deepEqual(term.raw, [true, false]);
      assert.ok(term.written().endsWith("\u001b[?25h"), "the cursor is back");
      assert.match(term.text(), /✗ .+stopped/u);
      for (const event of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) assert.equal(term.proc.listenerCount(event), 0);
      assert.equal(term.stdin.listenerCount("keypress"), 0);
    }
  }
});

test("a Ctrl+C typed while the card settles still aborts, and a closed terminal ends the question", async () => {
  const early = fakeTerminal();
  const aborted = assert.rejects(early.cards.choose(list), { message: "Aborted with Ctrl+C" });
  early.stdin.write(keys.ctrlC);
  await aborted;
  const closed = fakeTerminal();
  const ended = assert.rejects(closed.cards.choose(list), { message: "Aborted: the terminal closed" });
  await pause();
  closed.stdin.end();
  await ended;
  assert.deepEqual(closed.raw, [true, false]);
});

test("a signal restores the terminal before it ends the process; Ctrl+Z stops the job and draws the card again", async () => {
  const term = fakeTerminal();
  const answer = term.cards.choose(list);
  await pause();
  term.proc.emit("SIGTERM", "SIGTERM");
  assert.deepEqual(term.proc.kills, [[4242, "SIGTERM"]]);
  assert.deepEqual(term.raw, [true, false]);
  answer.catch(() => {});

  const stopped = fakeTerminal();
  const later = stopped.cards.choose(list);
  await term.press();
  await stopped.press(keys.ctrlZ);
  assert.deepEqual(stopped.proc.kills, [[0, "SIGTSTP"]]);
  assert.deepEqual(stopped.raw, [true, false]);
  stopped.proc.emit("SIGCONT");
  assert.deepEqual(stopped.raw, [true, false, true]);
  await stopped.press(keys.down, keys.enter);
  assert.equal(await later, 1);
});

test("a typed value is checked in the card, keeps its text after a mistake, and stops after the last try", async () => {
  const read = (text) => (text === "lab/m" ? { value: text, label: text } : { problem: `OpenCode does not list ${text}.` });
  const card = { title: "Lead model", note: "Type it.", example: "my-gateway/deepseek-chat", attempts: 3, exhausted: "No usable LEAD model was typed; nothing was written.", read };
  const term = fakeTerminal();
  const answer = term.cards.type(card);
  await pause();
  assert.match(term.text(), /my-gateway\/deepseek-chat/u, "the example shows while nothing is typed");
  await term.press("lab/x", keys.enter);
  assert.match(term.text(), /❯ lab\/x█[\s\S]*! OpenCode does not list lab\/x\. 2 tries left\./u);
  await term.press(keys.back, "m", keys.enter);
  assert.equal(await answer, "lab/m");
  const worn = fakeTerminal();
  const refused = assert.rejects(worn.cards.type(card), { message: card.exhausted });
  await worn.press("a", keys.enter, keys.enter);
  assert.match(worn.text(), /One try left\./u);
  await worn.press(keys.enter);
  await refused;
});

test("the look-over card keeps its warnings after it folds, and prints facts that do not fit above itself", async () => {
  const fields = [{ label: "Lead", value: "gpt-6-astra · xhigh" }, { label: "Warning", value: "OPENAI_API_KEY is not set; the route is written anyway", mark: "warn" }];
  const term = fakeTerminal();
  const answer = term.cards.proceed({ title: "Model route", note: "Nothing is written yet.", fields, done: "gpt-6-astra · xhigh" });
  await term.press("x", keys.enter);
  await answer;
  assert.deepEqual(term.lines().filter((line) => line !== ""), [" ✓ Model route          gpt-6-astra · xhigh", " ! OPENAI_API_KEY is not set; the route is written anyway"]);
  const small = fakeTerminal({ cols: 40, rows: 16 });
  const many = [...fields, ...Array.from({ length: 6 }, (_, index) => ({ label: `Note ${index}`, value: "OpenCode's model list could not be read, so it was not checked", mark: "warn" }))];
  const printed = small.cards.proceed({ title: "Model route", note: "Nothing is written yet.", fields: many, done: "ok" });
  await small.press();
  assert.match(small.text(), /Note 0[\s\S]*Note 5[\s\S]*Continue/u);
  await small.press(keys.enter);
  await printed;
  assert.match(small.text(), /Note 0[\s\S]*Note 5/u, "they stay on screen");
});

test("steps spin, fold to one line when done, and stay in view with the failed one marked", async () => {
  const rows = [{ name: "Resolve package", text: "find it" }, { name: "Verify install", text: "check it" }];
  const term = fakeTerminal();
  term.cards.startSteps("Installing", rows);
  assert.equal(await term.cards.runStep(0, async () => { assert.match(term.text(), /⠋ Resolve package[\s\S]*· Verify install/u); return 7; }), 7);
  await term.cards.runStep(1, async () => {});
  term.cards.finishSteps("Install steps", "2 of 2 checked");
  assert.deepEqual(term.lines().filter((line) => line !== ""), [" ✓ Install steps        2 of 2 checked"]);
  assert.deepEqual(term.raw, [true, false]);

  const broken = fakeTerminal();
  broken.cards.startSteps("Installing", rows);
  await assert.rejects(broken.cards.runStep(0, async () => { throw new Error("boom"); }), /boom/u);
  broken.cards.fail("Installer stopped before completion.");
  assert.match(broken.text(), /✗ Resolve package[\s\S]*✗ Installer stopped before completion\./u);
  assert.deepEqual(broken.raw, [true, false]);

  const interrupted = fakeTerminal();
  interrupted.cards.startSteps("Installing", rows);
  await interrupted.press("x", keys.ctrlC);
  assert.deepEqual(interrupted.proc.kills, [[0, "SIGINT"]], "Ctrl+C reaches the whole job, host command included");
  assert.deepEqual(interrupted.raw, [true, false]);
});

test("a blocking task holds the terminal until the next card, which reads a Ctrl+C typed meanwhile", async () => {
  const term = fakeTerminal();
  assert.equal(term.cards.busy("Model list", "reading", () => 3, (value) => ({ text: `${value} models` })), 3);
  assert.match(term.text(), /✓ Model list +3 models/u);
  assert.deepEqual(term.raw, [true], "still raw");
  const answer = term.cards.choose(list);
  const aborted = assert.rejects(answer, { message: "Aborted with Ctrl+C" });
  await term.press(keys.ctrlC);
  await aborted;
  assert.deepEqual(term.raw, [true, false]);
});

test("every card fits 40 to 120 columns and short windows, in every colour depth and in ASCII", async () => {
  const long = { label: "a-very-long-team-name/with-a-very-long-model-name-that-no-narrow-window-can-hold-70b-instruct", detail: "" };
  const makers = [
    (cards) => cards.choose(list),
    (cards) => cards.choose({ ...list, choices: [...list.choices, { label: "한국어 스타일", detail: "쉽게 설명하기 — a long hint that has to go under its row in a narrow window" }] }),
    (cards) => cards.choose({ title: "Helper reasoning effort", note: "Sets how hard it thinks.", choices: Array.from({ length: 10 }, (_, i) => ({ label: `row ${i}`, detail: "coding lead, previous generation" })), initial: 4 }),
    (cards) => cards.choose({ title: "Helper model", note: "Spawned and delegated agents run on this model.", choices: [long, ...models(200)], initial: 0 }),
    (cards) => cards.confirm(yesNo),
    (cards) => cards.proceed({ title: "Model route", note: "Nothing is written yet.", fields: [{ label: "Writes", value: "/a/very/long/path/without/any/space/in/it/at/all/opencode/litopencode.json" }], done: long.label }),
    (cards) => cards.type({ title: "Lead model", note: "Type the model as provider/model.", example: "my-gateway/deepseek-chat", attempts: 3, exhausted: "no", read: () => ({ problem: "OpenCode does not list that model at all." }) })
  ];
  for (const cols of [40, 60, 80, 100, 120]) {
    for (const rows of [12, 16, 24, 60]) {
      for (const env of [utf8, { LC_ALL: "C", TERM: "xterm" }]) {
        for (const make of makers) {
          const term = fakeTerminal({ cols, rows, env });
          const answer = make(term.cards);
          await pause(4);
          term.stdin.write("z");
          await pause(2);
          const shown = term.lines().filter((line) => line !== "");
          const top = shown.findLastIndex((line) => /^ (?:╭─|\+-).*LIT/u.test(line));
          assert.ok(shown.length - top + 1 <= rows, `${shown.length - top} rows in a window of ${rows}`);
          for (const line of shown) assert.ok(cellWidth(line) <= cols, `${cols}: ${line}`);
          assert.match(shown[top], /LIT/u, "the top border is on screen");
          assert.match(shown.at(-1), /^ (?:╰─+╯|\+-+\+)$/u);
          if (env.LC_ALL === "C") assert.doesNotMatch(shown.join(""), /[^\x20-\x7e]/u, "ASCII only");
          answer.catch(() => {});
          term.stdin.write(keys.ctrlC);
          await pause(2);
        }
      }
    }
  }
});

test("colour follows the terminal: none, 16, 256 or truecolor, and the default stays clear without it", async () => {
  const draw = async (depth, env = utf8) => {
    const term = fakeTerminal({ depth, env });
    const answer = term.cards.confirm(yesNo);
    await term.press("n");
    await answer;
    return term.written();
  };
  const plain = await draw(24, { ...utf8, NO_COLOR: "" });
  assert.doesNotMatch(plain, /\u001b\[[0-9;]*m/u);
  assert.match(strip(plain), /\[Y\/n\][\s\S]*❯ Yes \(default\)/u);
  assert.match(await draw(4), /\u001b\[(?:1;)?(?:3|9)[0-7]m/u);
  assert.doesNotMatch(await draw(4), /[34]8;[25];/u);
  assert.match(await draw(8), /[34]8;5;\d+/u);
  assert.doesNotMatch(await draw(8), /[34]8;2;/u);
  assert.match(await draw(24), /48;2;255;45;149/u);
});

test("sixteen colours mark the row in reverse video, and a cut answer stays ASCII in an ASCII locale", async () => {
  const term = fakeTerminal({ cols: 40, depth: 4, env: { LC_ALL: "C", TERM: "xterm" } });
  const answer = term.cards.choose({ ...list, choices: [{ label: "gateway/a-model-name-that-is-too-long-for-this-window" }, { label: "b" }] });
  await term.press(keys.enter);
  assert.equal(await answer, 0);
  assert.match(term.written(), /\u001b\[1;7m[^\u001b]*gateway/u);
  assert.match(term.text(), /ok Permissions gateway\/a-model[^\n]*~$/mu);
  assert.doesNotMatch(term.text(), /[^\x20-\x7e\n]/u);
});

test("text from a model list cannot act on the terminal", async () => {
  const term = fakeTerminal();
  const answer = term.cards.choose({ ...list, choices: [{ label: "lab/\u001b[2Jevil\u0007", detail: "" }, { label: "lab/ok", detail: "" }] });
  await pause();
  assert.doesNotMatch(term.written(), /\u001b\[2J|\u0007/u);
  await term.press(keys.enter);
  await answer;
});

test("a narrower window redraws the card at its new width", async () => {
  const term = fakeTerminal({ resizes: true });
  const answer = term.cards.choose(list);
  await pause();
  term.stdout.columns = 50;
  term.stdout.emit("resize");
  const card = term.lines().filter((line) => line.startsWith(" │") || line.startsWith(" ╭"));
  assert.ok(card.length > 4);
  for (const line of card) assert.equal(cellWidth(line), 49);
  await term.press(keys.enter);
  await answer;
});

test("the tag counts the questions of this run", async () => {
  const term = fakeTerminal();
  term.cards.expect(2);
  const first = term.cards.choose(list);
  await pause();
  assert.match(term.text(), /LIT 1\/2/u);
  await term.press(keys.enter);
  await first;
  const second = term.cards.confirm(yesNo);
  await pause();
  assert.match(term.text(), /LIT 2\/2/u);
  await term.press(keys.enter);
  await second;
});
