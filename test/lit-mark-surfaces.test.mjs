import assert from "node:assert/strict";
import { test } from "node:test";
import { banner, micro, standard, lockup } from "../src/lit-mark.ts";
import { ignitionMark, createIgnitionState } from "../src/ignition.ts";
import { renderLitOpenCodeWordmark, renderInstallTuiLogo, renderInstallTuiStage, shouldRenderInstallTui } from "../src/cli/install-tui.ts";
import { withMarkTerminal } from "../test-support/lit-mark-fixture.mjs";

const utf8 = { LANG: "en_US.UTF-8", TERM: "xterm-256color" };
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/gu, "");

test("installer wordmark uses B with the native name and version", () => {
  withMarkTerminal(() => {
    const wordmark = renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7");
    assert.equal(stripAnsi(wordmark), lockup("litopencode v9.8.7", banner).join("\n"));
    for (const rgb of ["255;99;55", "215;247;91", "242;239;223"]) assert.ok(wordmark.includes(`\u001b[38;2;${rgb}m`));
    assert.equal(renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7", false), stripAnsi(wordmark));
    const logo = renderInstallTuiLogo("@litfamily/litopencode@9.8.7");
    assert.ok(logo.includes(wordmark));
    assert.match(logo, /writes begin at 03 \/ 05/u);
    assert.match(logo, /\u001b\[38;2;255;90;31m/u);
    assert.match(logo, /\u001b\[38;2;250;204;21m/u);
  });
});

test("decorative B colors leave progress colors and JSON or dry-run suppression intact", () => {
  withMarkTerminal(() => {
    assert.match(renderInstallTuiStage("Register plugin", "running", 0), /\u001b\[38;5;221m⠋/u);
    assert.match(renderInstallTuiStage("Register plugin", "complete", 0), /\u001b\[38;5;82m✓/u);
    assert.equal(shouldRenderInstallTui(["install"]), true);
    assert.equal(shouldRenderInstallTui(["install", "--json"]), false);
    assert.equal(shouldRenderInstallTui(["install", "--dry-run"]), false);
  });
  withMarkTerminal(() => {
    assert.doesNotMatch(renderInstallTuiLogo("litopencode@9.8.7"), /\u001b/u);
    assert.doesNotMatch(renderInstallTuiStage("Register plugin", "running", 0), /\u001b/u);
  }, { color: false });
});

test("completion Markdown shows only standard or micro B rows with no ANSI or label", () => {
  assert.equal(ignitionMark(true, "lit-plan", utf8), ["```text", ...standard, "```"].join("\n"));
  assert.equal(ignitionMark(false, "lit-code", utf8), ["```text", ...micro, "```"].join("\n"));
  for (const env of [utf8, { ...utf8, CI: "" }, { ...utf8, NO_COLOR: "" }, { ...utf8, COLORTERM: "truecolor" }]) {
    assert.doesNotMatch(ignitionMark(true, "lit-plan", env), /\u001b/u);
  }
  for (const env of [{ LANG: "C" }, { ...utf8, TERM: "dumb" }]) {
    assert.equal(ignitionMark(false, "lit-plan", env), "```text\nLIT\n```");
  }
});

test("completion state preserves first, later, deleted and disposed session behavior", async () => {
  const state = createIgnitionState();
  const complete = async (sessionID, text) => {
    const output = { text };
    await state.complete({ sessionID, messageID: "message", partID: "part" }, output);
    return output.text;
  };
  try {
    state.activate("one", "lit-code");
    const reply = "🔥 **LIT IGNITED · lit-code** 🔥\nAnswer";
    assert.equal(await complete("one", reply), `${ignitionMark(true, "lit-code")}\n\n${reply}`);
    assert.equal(await complete("one", "No probe"), `${ignitionMark(false, "lit-code")}\n\nNo probe`);
    assert.equal(await complete("two", "New session"), `${ignitionMark(true, "lit-loop")}\n\nNew session`);
    state.clear("one");
    assert.equal(await complete("one", "Recreated"), `${ignitionMark(true, "lit-loop")}\n\nRecreated`);
    state.dispose();
    assert.equal(await complete("one", "After disposal"), "After disposal");
  } finally {
    state.dispose();
  }
});
