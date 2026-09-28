import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const cdn = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/`;
const readmes = {
  "README.md": {
    install: "## Install",
    skills: "## Skills at a glance",
    ab: "## A/B results",
    next: "## Commands",
    nav: '<a href="#skills-at-a-glance">Skills</a>',
    won: "**LitOpenCode won**",
    judgeOnly: " (blind judge; not reviewed by eye)",
    judge: { with: "LitOpenCode won", baseline: "Baseline won", tie: "Tie" },
    totalLabel: "Total",
    total: ["**10 wins**", "4 wins, 3 ties, 3 losses"],
    motion: "`lit-typographic-motion`, was rebuilt after its first A/B and has no A/B result yet.",
    cover: "The cover at the top of this README was made with the LitFamily motion skill.",
    sevenViews: "seven views"
  },
  "README-Ko-KR.md": {
    install: "## 설치",
    skills: "## 스킬 한눈에 보기",
    ab: "## A/B 결과",
    next: "## 명령어",
    nav: '<a href="#스킬-한눈에-보기">스킬</a>',
    won: "**LitOpenCode 승**",
    judgeOnly: " (블라인드 심사 결과, 눈으로 검토하지 않음)",
    judge: { with: "LitOpenCode 승", baseline: "기준선 승", tie: "무승부" },
    totalLabel: "합계",
    total: ["**10승**", "4승 3무 3패"],
    motion: "`lit-typographic-motion`은 첫 A/B 이후 새로 만들었고, 아직 A/B 결과가 없습니다.",
    cover: "이 README 맨 위 표지는 LitFamily 모션 스킬로 만들었습니다.",
    sevenViews: "일곱 가지 보기"
  }
};

// The maintainer's final call wins every task. S2 was not reviewed by eye, so its final
// verdict is the blind judge's. The last column is the blind judge of the same round.
const verdicts = [
  { task: "S1", prompt: "터미널에서 쓰는 할 일 관리 CLI 만들어줘", byEye: true, judge: "baseline" },
  { task: "S2", prompt: "이 API 서버 가끔 이상하게 동작하는데 고쳐줘", byEye: false, judge: "with" },
  { task: "S3", prompt: "개인 가계부 대시보드 웹페이지 만들어줘", byEye: true, judge: "with" },
  { task: "S4", prompt: "동네 카페 브랜드 랜딩페이지 만들어줘", byEye: true, judge: "baseline" },
  { task: "S5", prompt: "sources 폴더 자료로 보고서랑 발표자료 만들어줘", byEye: true, judge: "with" },
  { task: "S6", prompt: "Node 22에서 24로 올릴 때 달라지는 거 조사해줘", byEye: true, judge: "tie" },
  { task: "S7", prompt: "주문-결제-배송 서비스 구조도 그려줘", byEye: true, judge: "with" },
  { task: "S8", prompt: "분기 실적 발표자료 만들어줘", byEye: true, judge: "baseline" },
  { task: "S9", prompt: "신제품 기획서 써줘", byEye: true, judge: "tie" },
  { task: "S11", prompt: "회의실 예약 웹앱 만들어줘", byEye: true, judge: "tie" }
];
const newSkills = ["lit-pptx", "lit-docx", "lit-typographic-motion"];
const abPictures = [
  "S3/baseline-desktop.webp", "S3/lit-desktop.webp", "S3/baseline-phone.webp", "S3/lit-phone.webp",
  "S4/baseline-desktop.webp", "S4/lit-desktop.webp", "S4/baseline-phone.webp", "S4/lit-phone.webp",
  "S11/baseline-desktop.webp", "S11/lit-desktop.webp", "S11/baseline-phone.webp", "S11/lit-phone.webp",
  "S5/lit-slides.webp", "S8/baseline-slides.webp", "S8/lit-slides.webp", "S9/lit-pages.webp",
  "S7/lit-diagram.webp"
].map((file) => `docs/ab/${file}`).sort();

const text = (file) => fs.readFile(file, "utf8");
const cells = (row) => row.split("|").slice(1, -1).map((cell) => cell.trim());
const isWebp = (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";

function section(content, start, end) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return content.slice(from, to);
}

function assertAbTable(content, labels) {
  const ab = section(content, labels.ab, labels.next);
  const table = ab.slice(0, ab.indexOf("\n### "));
  const rows = table.split("\n").filter((line) => /^\| (?:S\d+|Total|합계) /u.test(line)).map(cells);
  assert.deepEqual(rows.map((row) => row[0].split(" ")[0]), [...verdicts.map(({ task }) => task), labels.totalLabel], "A/B rows and order");
  for (const [index, { task, prompt, byEye, judge }] of verdicts.entries()) {
    const row = rows[index];
    assert.equal(row.length, 4, `${task} has task, prompt, final verdict and blind judge`);
    assert.equal(row[1], prompt, `${task} shows the exact Korean prompt`);
    assert.equal(row[2], labels.won + (byEye ? "" : labels.judgeOnly), `${task} final verdict`);
    assert.equal(row[3], labels.judge[judge], `${task} blind judge verdict`);
  }
  assert.deepEqual(rows.at(-1).slice(2), labels.total, "A/B totals");
  assert.ok(ab.includes(labels.motion), "the rebuilt motion skill makes no A/B claim");
  assert.ok(ab.includes(labels.cover), "the cover credits the LitFamily motion skill");
  assert.doesNotMatch(ab, /\|\s*S10\b/u, "no motion task row");
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
    .filter((url) => url.startsWith(cdn + prefix))
    .map((url) => url.slice(cdn.length)))].sort();
}

test("A/B tables show the maintainer's final verdicts with the blind judge beside them", async () => {
  for (const [file, labels] of Object.entries(readmes)) {
    const content = await text(file);
    assertAbTable(content, labels);
    assert.throws(() => assertAbTable(content.replace(`| ${labels.won} | ${labels.judge.baseline} |`, `| ${labels.judge.baseline} | ${labels.judge.baseline} |`), labels));
    assert.throws(() => assertAbTable(content.replace(labels.judgeOnly, ""), labels));
    assert.throws(() => assertAbTable(content.replace(labels.total[1], labels.total[0]), labels));
    const ab = section(content, labels.ab, labels.next);
    assert.doesNotMatch(ab, /\.litclaude|evidence\/|round-\d|run[ _-]?id|receipt|illustrative/iu, `${file} A/B text carries no internal exhaust`);
    assert.doesNotMatch(ab, /🔥|LIT IGNITED|probe line/iu, `${file} A/B text does not score the product signature`);
    assert.doesNotMatch(content, /Simple-prompt A\/B|짧은 프롬프트 A\/B/u, `${file} dropped the superseded simple-round section`);
  }
});

test("A/B pictures are exactly the shipped WebP comparisons and the old captures are gone", async () => {
  const onDisk = await listFiles("docs/ab");
  assert.deepEqual(onDisk, abPictures);
  for (const file of Object.keys(readmes)) assert.deepEqual(referenced(await text(file), "docs/ab/"), abPictures, `${file} shows exactly the shipped A/B pictures`);
  for (const file of onDisk) assert.ok(isWebp(await fs.readFile(file)), `${file} is WebP`);
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
    assert.ok(content.includes(labels.nav), `${file}: top nav links the skill section`);
    const install = content.indexOf(labels.install);
    const skills = content.indexOf(labels.skills);
    const ab = content.indexOf(labels.ab);
    assert.ok(install >= 0 && skills > install && ab > skills, `${file}: install, skills, then A/B`);
    const table = section(content, labels.skills, labels.ab);
    const images = [...table.matchAll(/<img src="([^"]+)" width="240" alt="([^"]*)" \/>/gu)];
    const order = images.map((match) => match[1].slice(`${cdn}docs/assets/skills/`.length));
    assert.ok(images.every((match) => match[1].startsWith(`${cdn}docs/assets/skills/`)), `${file}: snapshots load from the pinned package`);
    assert.deepEqual([...order].sort(), snapshots, `${file}: rows match the snapshot files`);
    assert.equal(table.split("\n<tr>\n").length - 1, snapshots.length, `${file}: one row per snapshot`);
    assert.ok(images.every((match) => match[2].trim().length > 0), `${file}: snapshots carry alt text`);
    assert.ok(table.includes(labels.sevenViews), `${file}: the frontend-ui-ux row names the seven-view probe`);
    orders.push(order);
  }
  assert.deepEqual(orders[0], orders[1], "English and Korean tables list skills in the same order");
});

test("the npm package carries every README comparison and skill picture", () => {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(pack.status, 0, pack.stderr);
  const packed = new Set(JSON.parse(pack.stdout)[0].files.map((entry) => entry.path));
  for (const file of abPictures) assert.ok(packed.has(file), `${file} ships`);
  for (const id of newSkills) assert.ok(packed.has(`docs/assets/skills/${id}.webp`), `${id} snapshot ships`);
  assert.equal([...packed].filter((file) => file.startsWith("docs/ab/") && file.endsWith(".png")).length, 0, "old PNG captures do not ship");
});
