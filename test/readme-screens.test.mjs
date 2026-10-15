import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { showActivationToast } from "../src/activation.ts";
import { litOpenCodeAgents, toOpenCodeAgentConfig } from "../src/agents/registry.ts";
import { renderInstallTuiCompletion } from "../src/cli/install-tui.ts";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { paletteFromTheme } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { autoHandoffDirective, autoHandoffMarker, createAutoHandoffSettings } from "../src/auto-handoff.ts";
import { compactReminder } from "../src/auto-handoff-hooks.ts";
import os from "node:os";
import path from "node:path";

const assetRoot = "docs/assets/readme";
// The four on-screen pictures moved off the landing README into the GitHub screens pages, which load
// them by paths relative to docs/. The landing README's demo slot shows a recorded session GIF.
const pageAssetRoot = "assets/readme";
const githubReadmes = ["README.md", "README-Ko-KR.md"];
const screenPages = ["docs/screens.md", "docs/screens-Ko-KR.md"];
const npmReadmes = ["README-npm.md", "README-npm-Ko-KR.md"];
const MAX_SCREEN_BYTES = 70 * 1024;
const plain = (value) => value.replace(/\u001b\[[0-9;]*m/gu, "");

function activationToast(skillId = "lit-loop") {
  let body;
  showActivationToast({ tui: { showToast: (options) => { body = options.body; return Promise.resolve(); } } }, skillId, { LANG: "en_US.UTF-8" });
  return body;
}

const receipt = plain(renderInstallTuiCompletion()).replace(/[│╭╮╰╯─]/gu, " ").replace(/[ \t]+/gu, " ");
const toast = activationToast();
const toastLabel = toast.message.split("\n").at(-1);
const planner = toOpenCodeAgentConfig(litOpenCodeAgents.find((agent) => agent.id === "lit-plan")).permission;

const screens = [
  { name: "install-output", strings: ["INSTALL READY", "Plugin, routes, commands, and skills are ready.", "Restart OpenCode · press Tab · choose lit-loop"], code: receipt },
  { name: "doctor-output", strings: ["litopencode doctor", "ok", "plugin", "skills"], code: "litopencode doctor ok plugin skills" },
  { name: "ignition-toast", strings: [toast.title, toastLabel], code: `${toast.title} ${toastLabel}` },
  { name: "planner-permissions", strings: ["opencode debug agent lit-plan", "edit", "bash", "task"], code: "opencode debug agent lit-plan edit bash task" }
];

test("the on-screen pictures quote text the product prints", async () => {
  assert.equal(toast.variant, "warning");
  assert.equal(toast.duration, 6000);
  assert.equal(toastLabel, "🔥 LIT IGNITED · lit-loop 🔥");
  assert.deepEqual({ edit: planner.edit, bash: planner.bash, task: planner.task }, { edit: "deny", bash: "deny", task: "deny" });
  const pictureTag = (root, name) => new RegExp(`<picture><source media="\\(prefers-color-scheme: dark\\)" srcset="\\./${root}/${name}-dark\\.webp" /><img src="\\./${root}/${name}-light\\.webp" width="694" alt="([^"]+)" /></picture>`, "u");
  for (const file of screenPages) {
    const content = await fs.readFile(file, "utf8");
    for (const { name, strings, code } of screens) {
      const tag = content.match(pictureTag(pageAssetRoot, name));
      assert.ok(tag, `${file} embeds ${name} as a dark/light picture with alt text`);
      for (const text of strings) {
        assert.ok(tag[1].includes(text), `${file}: ${name} alt names "${text}"`);
        assert.ok(code.includes(text), `${name}: "${text}" comes from the product`);
      }
    }
  }
  // The recorded session routed the small task to lit-task; its toast label comes from the product.
  const demoToast = activationToast("lit-task").message.split("\n").at(-1);
  assert.equal(demoToast, "🔥 LIT IGNITED · lit-task 🔥");
  const film = await fs.readFile("docs/assets/demo.webp");
  assert.equal(film.subarray(0, 4).toString("ascii"), "RIFF", "demo.webp is a RIFF container");
  assert.equal(film.subarray(8, 12).toString("ascii"), "WEBP", "demo.webp is a WebP");
  assert.ok(film.length <= 8 * 1024 * 1024, `demo.webp is ${film.length} bytes, over 8 MiB`);
  await assert.rejects(fs.access("docs/assets/demo.gif"), { code: "ENOENT" }, "the old demo GIF is gone");
  assert.ok((await fs.readFile(".npmignore", "utf8")).split("\n").includes("docs/assets/demo.webp"), "demo.webp stays out of the npm package");
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    const line = content.split("\n").find((row) => row.includes("<!-- demo-gif -->"));
    assert.ok(line, `${file} marks its demo slot`);
    const tag = line.match(/<img src="\.\/docs\/assets\/demo\.webp" width="960" alt="([^"]{80,})" \/>/u);
    assert.ok(tag, `${file}: the demo slot shows the session film with a full alt text`);
    for (const text of [demoToast, "lit add a --shout flag that prints the greeting in capitals, with a test", "HELLO, ADA!"]) {
      assert.ok(tag[1].includes(text), `${file}: demo alt names "${text}"`);
    }
    assert.ok(content.indexOf("<!-- demo-gif -->") < content.indexOf("\n## "), `${file}: the demo slot sits above the first section`);
  }
  for (const file of npmReadmes) assert.doesNotMatch(await fs.readFile(file, "utf8"), /demo\.(?:gif|webp)/u, `${file} does not embed the demo film`);
});

test("on-screen pictures are small WebP files that stay out of the package", async () => {
  const ignore = await fs.readFile(".npmignore", "utf8");
  assert.ok(ignore.includes("\ndocs/assets/readme/*\n"), "the readme asset folder is excluded by default");
  for (const { name } of screens) {
    for (const theme of ["dark", "light"]) {
      const file = `${name}-${theme}.webp`;
      const bytes = await fs.readFile(`${assetRoot}/${file}`);
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", file);
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", file);
      assert.ok(bytes.length <= MAX_SCREEN_BYTES, `${file} is ${bytes.length} bytes`);
      assert.ok(!ignore.includes(`!${assetRoot}/${file}`), `${file} is shown only by the GitHub pages, so .npmignore keeps it out`);
    }
  }
});

test("on-screen captions say whether a picture is a capture or a sample", async () => {
  for (const file of screenPages) {
    const content = await fs.readFile(file, "utf8");
    const english = file === "docs/screens.md";
    const section = content.slice(content.indexOf(english ? "## What you will see on screen" : "## 설치 후 화면에서 보이는 것"), content.indexOf(english ? "## Watch it in motion" : "## 움직이는 화면으로 보기"));
    assert.ok(section.length > 0, `${file}: the on-screen section exists`);
    const captured = section.match(english ? /^\*Captured from the real/gmu : /^\*.*캡처했/gmu) ?? [];
    const samples = section.match(english ? /^\*Sample output/gmu : /^\*예시 화면입니다/gmu) ?? [];
    assert.equal(captured.length, 3, `${file}: install, doctor and planner pictures are captures`);
    assert.equal(samples.length, 1, `${file}: the toast picture is a sample`);
    assert.ok(section.includes(english ? "[What you will see](./guide.md#what-you-will-see)" : "[화면에서 보이는 것](./guide-Ko-KR.md#화면에서-보이는-것)"), `${file}: links to the Jev pictures instead of repeating them`);
  }
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    assert.doesNotMatch(content, /camera|카메라|replayed|다시 재생/u, `${file}: the demo film carries no notes on how it was made`);
    assert.ok(content.includes(file === "README.md" ? "[Screens](./docs/screens.md)" : "[화면 미리 보기](./docs/screens-Ko-KR.md)"), `${file}: the quick start still points to the screens page`);
    assert.doesNotMatch(content, /(?:doctor-output|ignition-toast|planner-permissions)-(?:dark|light)/u, `${file}: the other on-screen pictures live on the screens page`);
  }
  for (const file of npmReadmes) {
    const content = await fs.readFile(file, "utf8");
    assert.doesNotMatch(content, /(?:install-output|doctor-output|ignition-toast|planner-permissions)-(?:dark|light)/u, `${file} does not embed the on-screen pictures`);
  }
});

test("the README status card pictures show what the shipped card draws, and stay out of the package", async () => {
  // The pictures are the shipped card code drawn at 100 columns (a 98-cell card) with OpenCode's
  // opencode dark theme, from the states below; they must carry every string the alt text names.
  const now = Date.parse("2026-10-13T08:05:00.000Z");
  const criterion = (id, scenario, status) => ({ id, scenario, qaChannel: "", testRef: "", status, evidence: [] });
  const ledger = { version: 1, activeGoalId: "G1", goals: [{ id: "G1", sessionId: "ses_demo", objective: "Add a --lang es option that prints Hola", title: "Spanish greeting", status: "active", createdAt: "2026-10-13T08:04:30.000Z", updatedAt: "2026-10-13T08:04:40.000Z", criteria: [criterion("C1", "node greet.js --lang es prints Hola, world!", "pass"), criterion("C2", "the default greeting is unchanged", "pending"), criterion("C3", "npm test passes with a Spanish test", "pending")], checkpoints: [{ id: "k1", at: "2026-10-13T08:04:41.000Z", summary: "C1 green" }], steering: [], reviewBlockers: [] }] };
  const marks = [{ at: now - 20_000, mode: "lit-loop" }];
  const working = buildMissionView({ marks, todos: [], ledger, sessionStatus: "busy", live: { tool: "bash", start: now - 9_000 }, now, agent: "lit-loop" });
  const after = buildMissionView({ marks, todos: [], ledger, sessionStatus: "idle", now, agent: "lit-loop" });
  const idle = buildMissionView({ marks: [], todos: [], ledger: undefined, now });
  const draw = (view, chips, contextPercent, busy) => statusCard({ view, frame: restingFrameFor(view, now), chips, ...(busy === undefined ? {} : { busy }), figures: { contextPercent, branch: "main", inLane: false } }, paletteFromTheme(undefined), 98)
    .map((row) => row.map((segment) => segment.text).join("").replace(/[╭╰]─|─[╮╯]|─{2,}/gu, " ").replace(/[│╭╮╰╯]/gu, " ").replace(/ +/gu, " "));
  const cards = {
    idle: { rows: draw(idle, [], 4), strings: ["🔥 LIT · ready", "○ IDLE", "interview ─ plan ─ work ─ review ─ done", "add lit to a prompt to start", "skills none yet", "ctx 4% · ⎇ main"] },
    working: { rows: draw(working, [{ name: "lit-loop", current: true }], 4, true), strings: ["🔥 LIT · lit-loop", "● CRITERION", "interview – ━ plan – ━ CRITERION 1/3 ─ review ─ done", "bash · 0:09", "skills lit-loop", "ctx 4% · ⟳ 0m · ⎇ main"] },
    recent: { rows: draw(after, [{ name: "lit-loop", current: false }], 6, false), strings: ["🔥 LIT · lit-loop", "○ IDLE", "interview – ━ plan – ━ criterion ─ review ─ done", "▸ C2 the default greeting", "ctx 6% · ⟳ 0m · ⎇ main"] }
  };
  const ignore = await fs.readFile(".npmignore", "utf8");
  for (const [state, { rows, strings }] of Object.entries(cards)) {
    const file = `status-card-${state}.webp`;
    const bytes = await fs.readFile(`${assetRoot}/${file}`);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", file);
    assert.ok(bytes.length <= MAX_SCREEN_BYTES, `${file} is ${bytes.length} bytes`);
    assert.ok(!ignore.includes(`!${assetRoot}/${file}`), `${file} is shown only by the GitHub README, so .npmignore keeps it out`);
    for (const readme of githubReadmes) {
      const content = await fs.readFile(readme, "utf8");
      const tag = content.match(new RegExp(`<img src="\\./docs/assets/readme/${file.replace(".", "\\.")}" width="760" alt="([^"]+)" />`, "u"));
      assert.ok(tag, `${readme} shows the ${state} card with alt text`);
      for (const text of strings) {
        if (readme === "README.md") assert.ok(tag[1].includes(text), `${readme}: ${state} alt names "${text}"`);
        assert.ok(rows.join(" ").includes(text.split(", ")[0]), `${state}: "${text}" comes from the shipped card`);
      }
      assert.doesNotMatch(tag[1], /PLAN ━ WORK ━ REVIEW/u, `${readme}: the ${state} picture shows the workflow map, not the old three-step track`);
    }
  }
  // The card wears the LIT colours: the alt text names them, never a theme's purple.
  const colourWords = { "README.md": [/pink LIT/u, /bright cyan chip/u], "README-Ko-KR.md": [/분홍색 LIT/u, /밝은 하늘색 칩/u] };
  for (const readme of githubReadmes) {
    const content = await fs.readFile(readme, "utf8");
    const alts = [...content.matchAll(/<img src="\.\/docs\/assets\/readme\/status-card-[a-z]+\.webp" width="760" alt="([^"]+)" \/>/gu)].map((match) => match[1]).join("\n");
    for (const word of colourWords[readme]) assert.match(alts, word, `${readme}: the card alt text names ${word}`);
    assert.doesNotMatch(alts, /purple|보라/u, `${readme}: no theme purple left in the card alt text`);
  }
  for (const file of npmReadmes) assert.doesNotMatch(await fs.readFile(file, "utf8"), /status-card-/u, `${file} does not embed the card pictures`);
});

test("the README automatic handoff pictures quote what LitOpenCode says and stay out of the package", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-readme-handoff-"));
  try {
    const settings = createAutoHandoffSettings({ stateFile: path.join(dir, "auto-handoff.json"), config: { enabled: false, percent: null }, env: {} });
    const on = await settings.route("lit-handoff auto on 70", "chat");
    const status = await settings.route("lit-handoff auto status", "chat");
    const off = await settings.route("lit-handoff auto off", "chat");
    assert.ok(status.startsWith(on) && status.includes("The switch comes from the saved setting and the percent from the saved setting."));
    const directive = autoHandoffDirective(70, autoHandoffMarker("ses_2b9f1c7a4e", Date.parse("2026-10-12T17:05:00.000Z")));
    const hooks = await fs.readFile("src/auto-handoff-hooks.ts", "utf8");
    const doctor = await fs.readFile("src/cli/doctor.ts", "utf8");
    assert.ok(hooks.includes('title: "LitOpenCode auto-handoff"') && hooks.includes('"Handoff saved. Compacting the conversation now."'), "the toast text comes from the hooks");
    assert.equal(compactReminder, "Handoff saved. Run /compact now.");
    const pictures = {
      "auto-handoff-settings": { width: 760, strings: ["lit-handoff auto on 70", on, "lit-handoff auto status", "The switch comes from the saved setting and the percent from the saved setting", "lit-handoff auto off", off] },
      "auto-handoff-compact": { width: 760, strings: [directive.split("\n\n")[0], directive.split("\n\n")[2], "LitOpenCode auto-handoff", "Handoff saved. Compacting the conversation now."] },
      "auto-handoff-doctor": { width: 694, strings: ["LITOPENCODE_AUTO_HANDOFF=1 LITOPENCODE_AUTO_HANDOFF_PERCENT=70 litopencode doctor", "autoHandoff", "compactionPercent 90"] }
    };
    for (const key of ["autoHandoff:", "sources:", "compactionPercent:", "warnings:"]) assert.ok(doctor.includes(key), `doctor prints ${key}`);
    const ignore = await fs.readFile(".npmignore", "utf8");
    for (const [name, { width, strings }] of Object.entries(pictures)) {
      for (const theme of ["dark", "light"]) {
        const bytes = await fs.readFile(`${assetRoot}/${name}-${theme}.webp`);
        assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `${name}-${theme}`);
        assert.ok(bytes.length <= MAX_SCREEN_BYTES, `${name}-${theme}.webp is ${bytes.length} bytes`);
        assert.ok(!ignore.includes(`!${assetRoot}/${name}-${theme}.webp`), `${name}-${theme}.webp stays out of the package`);
      }
      for (const readme of githubReadmes) {
        const content = await fs.readFile(readme, "utf8");
        const tag = content.match(new RegExp(`<picture><source media="\\(prefers-color-scheme: dark\\)" srcset="\\./docs/assets/readme/${name}-dark\\.webp" /><img src="\\./docs/assets/readme/${name}-light\\.webp" width="${width}" alt="([^"]+)" /></picture>`, "u"));
        assert.ok(tag, `${readme} shows ${name} as a dark/light picture`);
        if (readme === "README.md") for (const text of strings) assert.ok(tag[1].includes(text), `${readme}: ${name} alt names "${text}"`);
      }
    }
    for (const file of npmReadmes) assert.doesNotMatch(await fs.readFile(file, "utf8"), /auto-handoff-(?:settings|compact|doctor)/u, `${file} does not embed the handoff pictures`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the quick start carries a copyable install prompt for a coding agent", async () => {
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    const quickStart = content.slice(content.indexOf(file === "README.md" ? "## Quick start" : "## 빠르게 시작하기"), content.indexOf(file === "README.md" ? "## What you get" : "## 할 수 있는 일"));
    const prompt = quickStart.match(/```text\n((?:(?!```)[\s\S])*?litopencode doctor[\s\S]*?)```/u)?.[1];
    assert.ok(prompt, `${file}: the quick start has an agent install prompt`);
    for (const text of ["@litfamily/litopencode", "npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run", "npm exec --package @litfamily/litopencode@latest -- litopencode install --yes", "npm exec --package @litfamily/litopencode@latest -- litopencode doctor", "install.ok", "lit-loop"]) {
      assert.ok(prompt.includes(text), `${file}: the agent prompt includes "${text}"`);
    }
    assert.match(prompt, file === "README.md" ? /ask me whether to go ahead/u : /나한테 물어봐/u, `${file}: the agent asks before installing`);
    assert.match(prompt, file === "README.md" ? /restart OpenCode/u : /OpenCode를 다시 시작/u, `${file}: the agent reminds the user to restart OpenCode`);
  }
});
