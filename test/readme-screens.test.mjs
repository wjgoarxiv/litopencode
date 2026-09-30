import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { showActivationToast } from "../src/activation.ts";
import { litOpenCodeAgents, toOpenCodeAgentConfig } from "../src/agents/registry.ts";
import { renderInstallTuiCompletion } from "../src/cli/install-tui.ts";

const assetRoot = "docs/assets/readme";
const githubReadmes = ["README.md", "README-Ko-KR.md"];
const npmReadmes = ["README-npm.md", "README-npm-Ko-KR.md"];
const MAX_SCREEN_BYTES = 70 * 1024;
const plain = (value) => value.replace(/\u001b\[[0-9;]*m/gu, "");

function activationToast() {
  let body;
  showActivationToast({ tui: { showToast: (options) => { body = options.body; return Promise.resolve(); } } }, "lit-loop", { LANG: "en_US.UTF-8" });
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
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    for (const { name, strings, code } of screens) {
      const tag = content.match(new RegExp(`<picture><source media="\\(prefers-color-scheme: dark\\)" srcset="\\./${assetRoot}/${name}-dark\\.webp" /><img src="\\./${assetRoot}/${name}-light\\.webp" width="694" alt="([^"]+)" /></picture>`, "u"));
      assert.ok(tag, `${file} embeds ${name} as a dark/light picture with alt text`);
      for (const text of strings) {
        assert.ok(tag[1].includes(text), `${file}: ${name} alt names "${text}"`);
        assert.ok(code.includes(text), `${name}: "${text}" comes from the product`);
      }
    }
  }
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
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    const english = file === "README.md";
    const section = content.slice(content.indexOf(english ? "## What you will see on screen" : "## 설치 후 화면에서 보이는 것"), content.indexOf(english ? "## Watch it in motion" : "## 움직이는 화면으로 보기"));
    assert.ok(section.length > 0, `${file}: the on-screen section exists`);
    const captured = section.match(english ? /^\*Captured from the real/gmu : /^\*.*캡처했/gmu) ?? [];
    const samples = section.match(english ? /^\*Sample output/gmu : /^\*예시 화면입니다/gmu) ?? [];
    assert.equal(captured.length, 3, `${file}: install, doctor and planner pictures are captures`);
    assert.equal(samples.length, 1, `${file}: the toast picture is a sample`);
    assert.ok(section.includes(english ? "[What you will see](#what-you-will-see)" : "[화면에서 보이는 것](#화면에서-보이는-것)"), `${file}: links to the Jev pictures instead of repeating them`);
  }
  for (const file of npmReadmes) {
    const content = await fs.readFile(file, "utf8");
    assert.doesNotMatch(content, /(?:install-output|doctor-output|ignition-toast|planner-permissions)-(?:dark|light)/u, `${file} does not embed the on-screen pictures`);
  }
});
