import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// The skills gallery moved off the landing README into GitHub docs pages that load the snapshots by
// paths relative to docs/. The A/B comparison was removed, so this file also guards its absence from
// the pages, the pictures and the package.
const local = "./";
const readmes = {
  "docs/skills.md": {
    landing: "README.md",
    commands: "## Commands",
    skills: "## Skills at a glance",
    next: "## How the plugin works",
    nav: '<a href="./docs/skills.md">Skills</a>',
    sevenViews: "seven views"
  },
  "docs/skills-Ko-KR.md": {
    landing: "README-Ko-KR.md",
    commands: "## 명령어",
    skills: "## 스킬 한눈에 보기",
    next: "## 플러그인이 동작하는 방식",
    nav: '<a href="./docs/skills-Ko-KR.md">스킬</a>',
    sevenViews: "일곱 가지 보기"
  }
};

const newSkills = ["lit-pptx", "lit-docx", "lit-typographic-motion"];
const text = (file) => fs.readFile(file, "utf8");
const cells = (row) => row.split("|").slice(1, -1).map((cell) => cell.trim());
const isWebp = (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";

function section(content, start, end) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return content.slice(from, to);
}

async function listFiles(root) {
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.posix.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function referenced(content, prefix) {
  return [...new Set([...content.matchAll(/(?:!\[[^\]]*\]\(|\b(?:src|srcset)=")([^)"\s]+)/gu)]
    .map((match) => match[1])
    .filter((url) => url.startsWith(local + prefix))
    .map((url) => url.slice(local.length)))].sort();
}

const removedComparison = /A\/B|blind judge|final verdict|docs\/ab\b|ab-results|ab-결과|블라인드|최종 판정|How it compared|비교해 보니/iu;

test("the pages carry no A/B comparison, blind-judge result or final verdict", async () => {
  for (const file of [...Object.keys(readmes), "README.md", "README-Ko-KR.md", "README-npm.md", "README-npm-Ko-KR.md"]) {
    const content = await text(file);
    const hit = content.split("\n").find((line) => removedComparison.test(line));
    assert.equal(hit, undefined, `${file} still shows comparison text: ${hit}`);
    assert.equal(referenced(content, "docs/ab/").length + referenced(content, "ab/").length, 0, `${file} shows no A/B picture`);
  }
});

test("the A/B pictures are gone from the tree", async () => {
  await assert.rejects(fs.access("docs/ab"), { code: "ENOENT" });
});

test("Skills at a glance lists every snapshot once, in the same order in both languages", async () => {
  const snapshots = (await fs.readdir("docs/assets/skills")).sort();
  assert.equal(snapshots.length, 38, "one snapshot per user-facing skill row");
  for (const id of [...newSkills, "frontend-ui-ux"]) assert.ok(snapshots.includes(`${id}.webp`), `${id} snapshot`);
  for (const name of snapshots) {
    const bytes = await fs.readFile(`docs/assets/skills/${name}`);
    assert.ok(isWebp(bytes), `${name} is WebP`);
    assert.ok(bytes.length <= 80 * 1024, `${name} stays at or under 80 KB`);
  }
  const orders = [];
  for (const [file, labels] of Object.entries(readmes)) {
    const content = await text(file);
    assert.ok((await text(labels.landing)).includes(labels.nav), `${labels.landing}: top nav links the skills gallery`);
    const commands = content.indexOf(labels.commands);
    const skills = content.indexOf(labels.skills);
    const next = content.indexOf(labels.next);
    assert.ok(commands >= 0 && skills > commands && next > skills, `${file}: commands, skills, then how the plugin works`);
    const table = section(content, labels.skills, labels.next);
    const images = [...table.matchAll(/<img src="([^"]+)" width="240" alt="([^"]*)" \/>/gu)];
    const order = images.map((match) => match[1].slice(`${local}assets/skills/`.length));
    assert.ok(images.every((match) => match[1].startsWith(`${local}assets/skills/`)), `${file}: snapshots load from the repository by paths relative to docs/`);
    assert.deepEqual([...order].sort(), snapshots, `${file}: rows match the snapshot files`);
    assert.equal(table.split("\n<tr>\n").length - 1, snapshots.length, `${file}: one row per snapshot`);
    assert.ok(images.every((match) => match[2].trim().length > 0), `${file}: snapshots carry alt text`);
    assert.ok(table.includes(labels.sevenViews), `${file}: the frontend-ui-ux row names the seven-view probe`);
    orders.push(order);
  }
  assert.deepEqual(orders[0], orders[1], "English and Korean tables list skills in the same order");
});

test("the npm package carries every README skill picture and no A/B picture", () => {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(pack.status, 0, pack.stderr);
  const packed = new Set(JSON.parse(pack.stdout)[0].files.map((entry) => entry.path));
  for (const id of newSkills) assert.ok(packed.has(`docs/assets/skills/${id}.webp`), `${id} snapshot ships`);
  assert.deepEqual([...packed].filter((file) => file.startsWith("docs/ab/")), [], "no A/B picture ships");
});

test("the npm pages send readers to the GitHub skills gallery", async () => {
  const pages = {
    "README-npm.md": {
      gallery: "https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills.md"
    },
    "README-npm-Ko-KR.md": {
      gallery: "https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills-Ko-KR.md"
    }
  };
  for (const [file, expected] of Object.entries(pages)) {
    const content = await text(file);
    assert.ok(content.includes(`](${expected.gallery})`), `${file} links the GitHub skills gallery`);
    assert.doesNotMatch(content, /docs\/assets\/skills\//u, `${file} leaves the skill snapshots to GitHub`);
  }
});
