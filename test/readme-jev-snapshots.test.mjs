import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { showJevSkillHintToast } from "../src/activation.ts";
import { jevSkillHintDoctorLine } from "../src/jev-skill-hint.ts";

const assetRoot = "docs/assets/readme";
const githubReadmes = ["README.md", "README-Ko-KR.md"];
const npmReadmes = ["README-npm.md", "README-npm-Ko-KR.md"];
const MAX_SNAPSHOT_BYTES = 128 * 1024;

function toastBody(hint, announce) {
  let body;
  showJevSkillHintToast({ tui: { showToast: (options) => { body = options.body; return Promise.resolve(); } } }, hint, announce);
  return body;
}

const hint = { kind: "hint", text: "unused", skillId: "lit-humanizer", latencyMs: 270 };
const snapshots = [
  {
    file: "jev-doctor.webp",
    strings: [
      jevSkillHintDoctorLine({}),
      jevSkillHintDoctorLine({ LITOPENCODE_JEV: "1" }),
      jevSkillHintDoctorLine({ LITOPENCODE_JEV: "1", TYPESAFE_API_KEY: "example-key" })
    ]
  },
  { file: "jev-toast-notice.webp", strings: [toastBody(undefined, true).message] },
  { file: "jev-toast-first-hint.webp", strings: [toastBody(hint, true).title, toastBody(hint, true).message] },
  { file: "jev-toast-hint.webp", strings: [toastBody(hint, false).message] }
];

test("Jev snapshot alt text quotes the strings the plugin prints", async () => {
  assert.equal(toastBody(undefined, true).variant, "warning");
  assert.equal(toastBody(hint, true).variant, "warning");
  assert.equal(toastBody(hint, false).variant, "info");
  assert.equal(toastBody(undefined, false), undefined, "a silent turn shows no toast");
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    for (const { file: image, strings } of snapshots) {
      const tag = content.match(new RegExp(`<img src="\\./${assetRoot}/${image}"[^>]*alt="([^"]+)"`, "u"));
      assert.ok(tag, `${file} embeds ${image} with alt text`);
      for (const text of strings) assert.ok(tag[1].includes(text), `${file}: ${image} alt names "${text}"`);
    }
  }
});

test("Jev snapshots are small WebP files that stay out of the package", async () => {
  const ignore = await fs.readFile(".npmignore", "utf8");
  assert.ok(ignore.includes(`\n${assetRoot}/*\n`), "the README asset folder is excluded by default");
  for (const { file } of snapshots) {
    const bytes = await fs.readFile(`${assetRoot}/${file}`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", file);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", file);
    assert.ok(bytes.length <= MAX_SNAPSHOT_BYTES, `${file} is ${bytes.length} bytes`);
    assert.ok(!ignore.includes(`!${assetRoot}/${file}`), `${file} is shown by the GitHub pages only, so .npmignore must not re-include it`);
  }
});

test("Jev snapshot captions say whether a picture is a capture or a sample", async () => {
  for (const file of githubReadmes) {
    const content = await fs.readFile(file, "utf8");
    const english = file === "README.md";
    assert.ok(content.includes(english ? "*Captured from the real `litopencode doctor`" : "*격리한 셸에서 실제 `litopencode doctor`를 실행해 캡처했고"), file);
    const samples = content.match(english ? /^\*Sample output/gmu : /^\*.*예시 화면입니다/gmu) ?? [];
    assert.equal(samples.length, 4, `${file}: the three Jev toast pictures and the ignition toast picture are labelled as samples`);
  }
  for (const file of npmReadmes) {
    const content = await fs.readFile(file, "utf8");
    assert.doesNotMatch(content, /jev-(?:doctor|toast)/u, `${file} does not embed the snapshots`);
  }
});
