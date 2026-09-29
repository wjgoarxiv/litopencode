import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const assetRoot = "docs/assets/readme";
// GitHub pages load assets by relative path; npm pages (copied over README.md / README-Ko-KR.md
// at pack time by tools/readme-for-npm.mjs) load the same files from the version-pinned package CDN.
const githubReadmes = ["README.md", "README-Ko-KR.md"];
const npmReadmes = ["README-npm.md", "README-npm-Ko-KR.md"];
const readmes = [...githubReadmes, ...npmReadmes];
const isEnglish = (file) => file === "README.md" || file === "README-npm.md";
const COVER = "docs/assets/cover-motion.webp";
const STATIC_COVER = "docs/assets/cover.webp";
const STILL_COVER = "docs/assets/cover-motion-still.webp";
const text = (file) => fs.readFile(file, "utf8");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const npmCdn = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/docs/assets`;
const npmPackage = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/`;
const assetPrefix = (file) => githubReadmes.includes(file) ? "./docs/assets" : npmCdn;
const motionPins = {
  "poster.png": "0fac2d0fc78d311710d1658968a45f8d9ff07ff73c6ca6f3ebc60bcb698d318f",
  "ignition-film.mp4": "b1579c89a677ab453765f77ae6361bd9730fabc4291a85071de7f373fc5ebfad",
  "ignition-readme.gif": "0be7badaee33df26a5a200c4f664273a21e9f2513fc066571f579f235220ca81",
  "promo.mp4": "c11effc005bb2fc4dae11a81ac1388dc39c8936b10737b9c6d311ed689d84559",
  "promo-preview.webp": "35e3784ddffdb7262d3daa591da78c97a79c54dd00db7f79510856fa9e27eea1",
  "promo-still.webp": "56079fddb727f3349e883f9f2ec60c01fa10fd24f33b82cee754d0943848366b"
};

function assertOutlinedMark(svg, rows) {
  assert.match(svg, /<svg\b[^>]*role="img"[^>]*aria-labelledby="title description"/u);
  assert.match(svg, /<title id="title">[^<]+<\/title>/u);
  assert.match(svg, /<path\b/u);
  assert.doesNotMatch(svg, /<(?:image|text|script|foreignObject|use)\b|\b(?:href|on\w+)\s*=|url\s*\(|data:/iu);
  assert.deepEqual([...svg.matchAll(/<g aria-label="([^"]*)">/gu)].map((match) => match[1]), rows.filter((row) => row !== ""));
}

function assertReleaseBadge(svg, version) {
  assert.ok(svg.includes(`aria-label="release: ${version}"`));
  assert.ok(svg.includes(`<title>release: ${version}</title>`));
  assert.ok(svg.includes(`>${version}</text>`));
  assert.doesNotMatch(svg, /\bcandidate\b/iu);
  assert.doesNotMatch(svg, /\b(?:href|on\w+)\s*=|<script\b|https:\/\/(?!www\.w3\.org\/)/iu);
}

test("README motion keeps centered outlined ASCII and the exact copyable native lockup", async () => {
  const fixture = JSON.parse(await text("test/fixtures/lit-mark/ignition-b.json"));
  const wordmarkColumn = Math.max(...fixture.banner.map(({ text: row }) => row.length)) + 8;
  const rows = fixture.banner.map(({ text: row }, index) => index === 10
    ? row.trimEnd().padEnd(wordmarkColumn) + "litopencode"
    : row.trimEnd());
  const svg = await text(`${assetRoot}/ascii-readme.svg`);
  assertOutlinedMark(svg, rows);
  assert.equal(digest(await fs.readFile(`${assetRoot}/JetBrainsMono-OFL.txt`)), "a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697");
  for (const file of readmes) {
    const content = await text(file);
    const assets = assetPrefix(file);
    assert.ok(content.includes(COVER), file + ": repository cover must be present");
    assert.ok(!content.includes(STATIC_COVER), file + ": the static robot cover is no longer a separate README image");
    assert.ok(content.includes(STILL_COVER), file + ": motion still is the reduced-motion source");
    assert.match(content, /<picture><source media="\(prefers-reduced-motion: reduce\)" srcset="[^"]+cover-motion-still\.webp" \/><img src="[^"]+cover-motion\.webp" width="100%" alt="[^"]+" \/><\/picture><\/p>/u);
    const expectedAlt = isEnglish(file)
      ? "LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up."
      : "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상";
    assert.ok(content.includes('alt="' + expectedAlt + '"'), file + ": cover alt text is accurate and localized");
    assert.ok(content.includes('srcset="' + assets + '/cover-motion-still.webp"'), file);
    assert.ok(content.includes('src="' + assets + '/cover-motion.webp'), file);
    assert.doesNotMatch(content, /View the static (?:family )?cover|정지 (?:패밀리 )?표지 보기/u, file + ": the hidden hyperlink to the cover is gone");
    const heroClose = content.indexOf("</picture></p>");
    const asciiIndex = content.indexOf(assetRoot + "/ascii-readme.svg");
    assert.equal(content.slice(0, heroClose).split("<img ").length - 1, 1, file + ": the motion cover is the README's single leading picture");
    assert.equal(content.indexOf("<img ", heroClose), content.lastIndexOf("<img ", asciiIndex), file + ": the ASCII decoration is the next image after the motion cover");
    if (githubReadmes.includes(file)) {
      const linksHeading = file === "README.md" ? "## Links" : "## 링크";
      const linksStart = content.indexOf(linksHeading);
      const familyStart = content.indexOf("### LITFAMILY", linksStart);
      const motionStart = content.indexOf("### Ignition motion", familyStart);
      assert.ok(linksStart >= 0 && familyStart > linksStart && motionStart > familyStart, file + ": family art is in Links near the end");
      const familyImages = [...content.slice(familyStart, motionStart).matchAll(/!\[[^\]]+\]\(([^)]+cover\.webp)\)/gu)];
      assert.equal(familyImages.length, 0, file + ": the duplicate robot cover no longer repeats in Links");
    }
    assert.equal(content.split("docs/assets/cover.webp").length - 1, 0, file + ": the static robot cover image no longer appears");
    assert.ok(content.includes(`<p align="center"><img src="${assets}/readme/ascii-readme.svg" width="480"`), file);
    const copy = content.match(/<details>\n<summary>[^<]+<\/summary>\n\n```text\n([\s\S]*?)\n```\n\n<\/details>/u)?.[1];
    assert.equal(copy, rows.join("\n"), `${file} copyable ASCII changed`);
    assert.ok(content.includes(`${assets}/readme/JetBrainsMono-OFL.txt`), file + ": the ASCII font license is linked");
    assert.doesNotMatch(content, /<!--[^]*?(?:visual draft|rerun native)/iu);
  }
  assert.throws(() => assertOutlinedMark(svg.replace("<path ", '<image href="https://example.invalid/mark.png" '), rows));
  assert.throws(() => assertOutlinedMark(svg.replace('aria-label="', 'aria-label="changed '), rows));
});

test("README motion and MIT badges stay local and identify the scoped release", async () => {
  const pkg = JSON.parse(await text("package.json"));
  const badge = await text(`${assetRoot}/badge-version.svg`);
  assertReleaseBadge(badge, pkg.version);
  assert.throws(() => assertReleaseBadge(badge.replaceAll(pkg.version, "9.8.7"), pkg.version));
  assert.throws(() => assertReleaseBadge(badge, "9.8.7"));
  const license = await text(`${assetRoot}/badge-license.svg`);
  assert.match(license, /aria-label="license: MIT"/u);
  assert.match(license, />MIT<\/text>/u);
  for (const file of readmes) {
    const content = await text(file);
    for (const name of ["badge-version.svg", "badge-license.svg"]) assert.ok(content.includes(`${assetRoot}/${name}`), `${file} shows ${name}`);
    assert.doesNotMatch(content, /unpublished local candidate|아직 공개되지 않은 로컬 후보|availability has not been established|현재 registry에서 설치할 수 있다는 뜻은 아닙니다/u);
    assert.match(content, /npm exec --package @litfamily\/litopencode@latest -- litopencode install/u);
  }
});

test("README motion uses all three licensed Lucide icons for meaningful local destinations", async () => {
  for (const name of ["book-open", "play", "shield-check"]) {
    const icon = await text(`${assetRoot}/lucide-${name}.svg`);
    assert.match(icon, /viewBox="0 0 24 24"/u);
    assert.match(icon, /stroke="#D7F75B"/u);
    assert.doesNotMatch(icon, /<script\b|\b(?:href|on\w+)\s*=/iu);
    for (const file of githubReadmes) assert.ok((await text(file)).includes(`./${assetRoot}/lucide-${name}.svg`), `${file} shows lucide-${name}`);
  }
  assert.equal(digest(await fs.readFile(`${assetRoot}/Lucide-LICENSE.txt`)), "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57");
  for (const file of githubReadmes) {
    const content = await text(file);
    const reference = file === "README.md" ? "docs/reference.md" : "docs/reference-Ko-KR.md";
    assert.ok(content.includes(`<a href="./${reference}"><img src="./${assetRoot}/lucide-book-open.svg"`), file);
    assert.ok(content.includes(`<a href="#ignition-motion"><img src="./${assetRoot}/lucide-play.svg"`), file);
    assert.ok(content.includes(`<a href="./LICENSE"><img src="./${assetRoot}/lucide-shield-check.svg"`), file);
    assert.ok(content.includes(`./${assetRoot}/Lucide-LICENSE.txt`), file);
  }
  // The npm card has no icon row, so it needs no icon license link.
  for (const file of npmReadmes) assert.doesNotMatch(await text(file), /lucide-/u, `${file} carries no Lucide icon`);
});

test("README motion resources have exact approved bytes and are reachable from both languages", async () => {
  assert.equal(digest(await fs.readFile("docs/assets/cover.webp")), "00b045cf08c00ed3c2b5205645689a035be8f56540a289f9b9a9cad6a7ef9251");
  const motionCover = await fs.readFile("docs/assets/cover-motion.webp");
  assert.ok(motionCover.length <= 2_621_440, "motion cover must stay under 2.5 MiB");
  assert.equal(digest(motionCover), "9997081327cf54ae4a8e2a1dce308ea572f7895095f8542b0304e4327d7afa9f");
  for (const [name, expected] of Object.entries(motionPins)) {
    assert.equal(digest(await fs.readFile(`${assetRoot}/${name}`)), expected, name);
    for (const file of githubReadmes) assert.ok((await text(file)).includes(`./${assetRoot}/${name}`), `${file} links ${name}`);
  }
  for (const file of readmes) {
    const content = await text(file);
    const github = githubReadmes.includes(file);
    const targets = [
      ...[...content.matchAll(/\]\(([^)\s]+)\)/gu)].map((match) => match[1]),
      ...[...content.matchAll(/\b(?:href|src|srcset)="([^"]+)"/gu)].map((match) => match[1])
    ];
    for (const target of targets) {
      if (target.startsWith("#") || target.startsWith("https://")) continue;
      assert.ok(github, `${file} contains a repo-relative npm README URL: ${target}`);
      assert.ok(target.startsWith("./"), `${file} relative target must start with ./: ${target}`);
      const local = decodeURI(target.slice(2).split("#")[0]);
      assert.equal((await fs.stat(path.resolve(local))).isFile(), true, `${file} -> ${target}`);
    }
    const imageTargets = [
      ...[...content.matchAll(/\]\(([^)\s]+\.(?:png|svg|gif|webp))\)/giu)].map((match) => match[1]),
      ...[...content.matchAll(/\b(?:src|srcset)="([^"]+)"/giu)].map((match) => match[1].split(/[\s,]/u)[0])
    ];
    for (const target of imageTargets) {
      if (github) {
        assert.ok(target.startsWith("./"), `${file} image must use a relative path: ${target}`);
        continue;
      }
      assert.ok(target.startsWith(npmPackage), `${file} image must use the package CDN URL: ${target}`);
      const packagePath = new URL(target).pathname.split(`/npm/@litfamily/litopencode@${version}/`)[1];
      if (packagePath) assert.equal((await fs.stat(path.resolve(packagePath))).isFile(), true, `${file} -> ${target}`);
    }
    if (github) assert.doesNotMatch(content, /cdn\.jsdelivr\.net/u, `${file} renders from the repository, not the package CDN`);
  }
});


test("README places the cover and decoration before its intro, then install and a first task", async () => {
  for (const file of readmes) {
    const content = await text(file);
    const intro = content.indexOf(isEnglish(file)
      ? "LitOpenCode adds workflow agents, slash commands, and a local evidence ledger to OpenCode."
      : "LitOpenCode는 OpenCode에 워크플로 agent, 슬래시 명령, 로컬 근거 기록을 더합니다.");
    const install = content.indexOf(isEnglish(file) ? "## Install" : "## 설치");
    const firstTask = content.indexOf(String.fromCharCode(96).repeat(3) + "text\nlit ");
    const cover = content.indexOf(COVER);
    const ascii = content.indexOf(assetRoot + "/ascii-readme.svg");
    const title = content.indexOf("# LitOpenCode\n");
    assert.ok(cover >= 0 && cover < ascii && ascii < title, file + ": motion cover and ASCII decoration lead");
    assert.ok(intro > title && install > intro && firstTask > install, file + ": intro, install, and first task follow in order");
    if (githubReadmes.includes(file)) {
      const wordmark = content.indexOf("docs/assets/readme/litopencode-wordmark.svg");
      const clay = content.indexOf("docs/assets/readme/litopencode-clay-icon.png");
      assert.ok(wordmark > title && wordmark < intro, file + ": product wordmark follows the title");
      assert.ok(clay > wordmark && clay < intro, file + ": clay mark follows the wordmark");
      assert.match(content, /litfamily-machines\.png/u);
    }
  }
});

test("README promo film is embedded once per GitHub page with capped files and a reduced-motion still", async () => {
  const promo = { mp4: "promo.mp4", preview: "promo-preview.webp", still: "promo-still.webp" };
  assert.ok((await fs.stat(`${assetRoot}/${promo.mp4}`)).size <= 8 * 1024 * 1024, "promo MP4 must stay under 8 MiB");
  assert.ok((await fs.stat(`${assetRoot}/${promo.preview}`)).size <= 2_621_440, "promo preview must stay under 2.5 MiB");
  assert.ok((await fs.stat(`${assetRoot}/${promo.still}`)).size <= 262_144, "promo still must stay small");
  for (const name of [promo.preview, promo.still]) {
    const bytes = await fs.readFile(`${assetRoot}/${name}`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", name);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", name);
  }
  const mp4 = await fs.readFile(`${assetRoot}/${promo.mp4}`);
  assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp", "promo.mp4 is an MP4 container");
  assert.ok((await fs.stat(`${assetRoot}/promo-source/index.html`)).size < 65_536, "editable film source stays small");
  const treatment = JSON.parse(await fs.readFile(`${assetRoot}/promo-source/treatment.json`, "utf8"));
  assert.ok(treatment.durationSec >= 15 && treatment.durationSec <= 25, "promo runs 15 to 25 seconds");
  assert.equal(treatment.format, "16:9");
  for (const file of githubReadmes) {
    const content = await text(file);
    const english = isEnglish(file);
    const heading = english ? "## Watch it in motion" : "## 움직이는 화면으로 보기";
    const start = content.indexOf(heading);
    assert.ok(start > content.indexOf(english ? "## Your first task" : "## 첫 작업"), `${file}: the promo follows the first task`);
    assert.ok(start < content.indexOf(english ? "## Skills at a glance" : "## 스킬 한눈에 보기"), `${file}: the promo sits before the skills tour`);
    const section = content.slice(start, content.indexOf("\n## ", start + 4));
    const picture = section.match(/<picture><source media="\(prefers-reduced-motion: reduce\)" srcset="\.\/docs\/assets\/readme\/promo-still\.webp" \/><img src="\.\/docs\/assets\/readme\/promo-preview\.webp" width="100%" alt="([^"]+)" \/><\/picture>/u);
    assert.ok(picture, `${file}: promo uses the reduced-motion picture pattern`);
    for (const word of ["lit-loop", "lit-plan", "/lit-recap", "Keep the work lit."]) assert.ok(picture[1].includes(word), `${file}: alt text names ${word}`);
    assert.ok(section.includes("](./docs/assets/readme/promo.mp4)"), `${file}: the MP4 is linked separately`);
    assert.equal(content.split("promo-preview.webp").length - 1, 1, `${file}: the animated preview appears once`);
    assert.ok(content.indexOf(COVER) < start, `${file}: the cover stays the first screen`);
  }
  for (const file of npmReadmes) assert.doesNotMatch(await text(file), /promo/u, `${file}: the npm card does not embed the promo`);
  const ignore = await text(".npmignore");
  assert.ok(ignore.includes(`\n${assetRoot}/*\n`), "the README asset folder is excluded by default");
  for (const name of [promo.mp4, promo.preview, promo.still, "promo-source"]) {
    assert.ok(!ignore.includes(`!${assetRoot}/${name}`), `${name} is shown by the GitHub pages only, so .npmignore must not re-include it`);
  }
});
