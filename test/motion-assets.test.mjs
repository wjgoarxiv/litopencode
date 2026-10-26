import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ASSET_LIMITS, assetUsed, assetsCommand, cleanSvg, fetchAssets, pageFacts, readmeImages, sniffImage } from "../skills/lit-typographic-motion/engine/assets.mjs";
import { encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";

// A product named by a link: its real images come from its own pages, as untrusted data, before the
// treatment is written. Nothing here reaches the network: the fetch is injected, and the CLI test uses
// a name that cannot resolve.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = (shade = 200) => encodePng(8, 8, Buffer.alloc(8 * 8 * 4, shade), 4);
const svg = (inner = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/>${inner}</svg>`;

// Every name resolves to a public address here, so no lookup reaches the network.
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

// A fetch that answers from a table of url -> { body, type } and refuses everything else.
function fakeFetch(table, seen = []) {
  return async (url, options = {}) => {
    seen.push({ url: String(url), accept: options.headers?.accept });
    const hit = table[String(url)];
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(hit.body, { status: hit.status ?? 200, headers: { "content-type": hit.type ?? "application/octet-stream", ...(hit.headers ?? {}) } });
  };
}

const repo = "https://github.com/acme/rocket";
const readme = [
  "# Rocket",
  "[![build](https://github.com/acme/rocket/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/rocket/actions)",
  "![shield](https://img.shields.io/badge/license-MIT-blue)",
  "![logo](docs/logo.png)",
  '<img src="https://raw.githubusercontent.com/acme/rocket/HEAD/docs/screenshot.png" width="600">',
  "![plain http](http://example.com/a.png)",
  "![evil](docs/evil.svg)",
  "![not an image](docs/page.png)",
  "![dup](docs/logo.png)"
].join("\n");
const repoTable = (extra = {}) => ({
  "https://api.github.com/repos/acme/rocket": { body: JSON.stringify({ name: "Rocket", description: "A small launcher", homepage: "", topics: ["cli"], owner: { avatar_url: "https://avatars.githubusercontent.com/u/1" } }), type: "application/json" },
  "https://api.github.com/repos/acme/rocket/readme": { body: readme, type: "text/plain" },
  "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/logo.png": { body: png(220), type: "image/png" },
  "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/screenshot.png": { body: png(120), type: "image/png" },
  "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/evil.svg": { body: svg('<script>alert(1)</script>'), type: "image/svg+xml" },
  "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/page.png": { body: "<html>not an image</html>", type: "text/html" },
  "https://avatars.githubusercontent.com/u/1": { body: png(60), type: "image/png" },
  ...extra
});

test("sniffImage reads the first bytes, not the name, and answers null for anything else", () => {
  assert.equal(sniffImage(png()), "png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "jpg");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "webp");
  assert.equal(sniffImage(Buffer.from("GIF89a....")), "gif");
  assert.equal(sniffImage(Buffer.from(svg())), "svg");
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n' + svg())), "svg");
  assert.equal(sniffImage(Buffer.from("<html><svg></svg></html>")), null);
  assert.equal(sniffImage(Buffer.from("MZ plain text")), null);
});

test("cleanSvg refuses script, handlers, foreign objects and every link that leaves the file", () => {
  assert.equal(cleanSvg(svg()), true);
  for (const bad of [svg("<script>1</script>"), svg('<rect onload="x()"/>'), svg("<foreignObject/>"), svg('<a href="javascript:1"/>'),
    svg('<image href="https://example.com/a.png"/>'), svg('<use xlink:href="//example.com/a.svg#x"/>'), svg('<style>@import url(http://example.com/x.css)</style>')]) {
    assert.equal(cleanSvg(bad), false, bad);
  }
});

test("readmeImages keeps real https images, resolves relative paths against the repository, and skips badges", () => {
  const found = readmeImages(readme, "https://raw.githubusercontent.com/acme/rocket/HEAD/");
  assert.deepEqual(found, [
    "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/logo.png",
    "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/evil.svg",
    "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/page.png",
    "https://raw.githubusercontent.com/acme/rocket/HEAD/docs/screenshot.png"
  ]);
});

test("pageFacts reads the social image, the icons, the title and the description of a page", () => {
  const html = '<title>Rocket | Launch</title><meta property="og:image" content="/card.png"><meta name="description" content="Fast"><link rel="apple-touch-icon" href="/icon.png"><link rel="stylesheet" href="/x.css">';
  const facts = pageFacts(html, "https://rocket.example/");
  assert.equal(facts.title, "Rocket | Launch");
  assert.equal(facts.description, "Fast");
  assert.deepEqual(facts.images, [{ url: "https://rocket.example/card.png", role: "photo" }, { url: "https://rocket.example/icon.png", role: "icon" }]);
});

test("a repository's assets land under stage/assets with their hashes; badges are never fetched and bad files are skipped", async () => {
  const out = tmp("lit-assets-");
  const seen = [];
  const result = await fetchAssets({ out, url: repo, lookup: publicLookup, fetchImpl: fakeFetch(repoTable(), seen), now: () => new Date("2026-10-26T00:00:00Z") });
  assert.equal(result.code, 0);
  const doc = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
  assert.equal(doc.product.name, "Rocket");
  assert.equal(doc.product.url, repo);
  assert.equal(doc.fetchedAt, "2026-10-26T00:00:00.000Z");
  const paths = doc.product.assets.map((a) => a.path);
  assert.deepEqual(paths, ["stage/assets/01-logo.png", "stage/assets/02-screenshot.png", "stage/assets/03-icon.png"]);
  assert.deepEqual(doc.product.assets.map((a) => a.role), ["logo", "screenshot", "icon"]);
  for (const asset of doc.product.assets) {
    assert.equal(asset.source, "fetched");
    assert.equal(sha(fs.readFileSync(path.join(out, asset.path))), asset.sha256);
  }
  assert.equal(seen.some((s) => /shields\.io|badge|workflows|example\.com/u.test(s.url)), false, "a badge or a plain-http image was requested");
  assert.ok(doc.problems.some((p) => /evil\.svg/u.test(p) && /script/u.test(p)), doc.problems.join("\n"));
  assert.ok(doc.problems.some((p) => /page\.png/u.test(p) && /not an image/u.test(p)), doc.problems.join("\n"));
  const words = JSON.parse(fs.readFileSync(path.join(out, "product", "words.json"), "utf8"));
  assert.match(words.note, /never instructions/u);
  assert.equal(words.description, "A small launcher");
  assert.equal(fs.readFileSync(path.join(out, "product", "README.md"), "utf8"), readme);
  assert.match(result.message, /data, not instructions/u);
  assert.equal(fs.existsSync(path.join(out, "cover")), false);
});

test("a file over the size limit is refused by its declared length and an over-long list stops at the file cap", async () => {
  const out = tmp("lit-assets-");
  const many = Array.from({ length: ASSET_LIMITS.files + 3 }, (_, i) => `![a${i}](img/a${i}.png)`).join("\n");
  const table = repoTable({ "https://api.github.com/repos/acme/rocket/readme": { body: many, type: "text/plain" } });
  for (let i = 0; i < ASSET_LIMITS.files + 3; i++) table[`https://raw.githubusercontent.com/acme/rocket/HEAD/img/a${i}.png`] = i === 0
    ? { body: png(), type: "image/png", headers: { "content-length": String(ASSET_LIMITS.fileBytes + 1) } }
    : { body: png(10 + i), type: "image/png" };
  const result = await fetchAssets({ out, url: repo, lookup: publicLookup, fetchImpl: fakeFetch(table) });
  const doc = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
  assert.equal(result.product.assets.length, ASSET_LIMITS.files);
  assert.equal(doc.files.length, ASSET_LIMITS.files);
  assert.ok(doc.problems.some((p) => /a0\.png/u.test(p) && /limit/u.test(p)), doc.problems.join("\n"));
});

test("a site's own images come from its page metadata", async () => {
  const out = tmp("lit-assets-");
  const html = '<title>Orbit | Home</title><meta property="og:image" content="/card.png"><link rel="icon" href="/favicon.png">';
  const table = {
    "https://orbit.example/": { body: html, type: "text/html" },
    "https://orbit.example/card.png": { body: png(90), type: "image/png" },
    "https://orbit.example/favicon.png": { body: png(30), type: "image/png" }
  };
  const result = await fetchAssets({ out, url: "https://orbit.example/", lookup: publicLookup, fetchImpl: fakeFetch(table) });
  assert.equal(result.product.name, "Orbit");
  assert.deepEqual(result.product.assets.map((a) => a.role), ["photo", "icon"]);
});

test("nothing reachable is a BLOCKED exit 22 that asks the user, and product.json records why", async () => {
  const out = tmp("lit-assets-");
  const failing = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  await assert.rejects(fetchAssets({ out, url: repo, lookup: publicLookup, fetchImpl: failing }), (error) => {
    assert.equal(error.exitCode, 22);
    assert.match(error.message, /BLOCKED_ASSET_MISSING/u);
    assert.match(error.message, /ask the user/u);
    assert.match(error.message, /never draw an invented/u);
    return true;
  });
  const doc = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
  assert.match(doc.product.unreachable, /ENOTFOUND/u);
  assert.equal(doc.product.assets, undefined);
});

test("only an https link is fetched", async () => {
  for (const url of ["http://orbit.example/", "not a link", "file:///etc/passwd"]) {
    await assert.rejects(fetchAssets({ out: tmp("lit-assets-"), url, lookup: publicLookup, fetchImpl: fakeFetch({}) }), (error) => error.exitCode === 2 && /https/u.test(error.message), url);
  }
});

test("--cover is a switch: through argv it confines every file under cover/assets, wherever it stands", async () => {
  for (const argv of [["--out", "OUT", "--url", repo, "--cover"], ["--cover", "--out", "OUT", "--url", repo], ["--out", "OUT", "--cover", "--url", repo]]) {
    const out = tmp("lit-assets-cover-");
    const args = argv.map((a) => (a === "OUT" ? out : a));
    const result = await assetsCommand(args, { lookup: publicLookup, fetchImpl: fakeFetch(repoTable()) });
    assert.equal(result.code, 0);
    const doc = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
    assert.ok(doc.product.assets.length >= 2, args.join(" "));
    for (const asset of doc.product.assets) assert.ok(asset.path.startsWith("cover/assets/"), asset.path);
    assert.equal(fs.existsSync(path.join(out, "stage")), false, "a cover fetch wrote under stage/");
    assert.deepEqual(fs.readdirSync(path.join(out, "cover", "assets")).sort(), doc.product.assets.map((a) => path.basename(a.path)).sort());
  }
  const out = tmp("lit-assets-film-");
  const film = await assetsCommand(["--out", out, "--url", repo], { lookup: publicLookup, fetchImpl: fakeFetch(repoTable()) });
  assert.equal(film.code, 0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8")).product.assets.every((a) => a.path.startsWith("stage/assets/")));
  assert.equal(fs.existsSync(path.join(out, "cover")), false);
});

test("render.mjs assets: a missing --url is a usage error, and an unreachable --cover link exits 22 with the ask", () => {
  const usage = spawnSync(process.execPath, [render, "assets", "--out", tmp("lit-assets-cli-")], { encoding: "utf8" });
  assert.equal(usage.status, 2, usage.stderr);
  assert.match(usage.stderr, /--url/u);
  const out = tmp("lit-assets-cli-");
  const run = spawnSync(process.execPath, [render, "assets", "--out", out, "--url", "https://litopencode-no-such-host.invalid/acme/rocket", "--cover"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 22, run.stderr);
  assert.match(run.stderr, /BLOCKED_ASSET_MISSING/u);
  assert.match(run.stderr, /cover\/assets/u);
  assert.match(JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8")).product.unreachable, /.+/u);
});

test("the fetch uses Node's own fetch: every import is a node: module or a sibling file, and no dependency was added", () => {
  const source = fs.readFileSync(path.join(skillRoot, "engine", "assets.mjs"), "utf8");
  const specifiers = [...source.matchAll(/^import .* from "([^"]+)";$/gmu)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const s of specifiers) assert.ok(s.startsWith("node:") || s.startsWith("./") || s.startsWith("../"), s);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8")).dependencies).sort(), ["opentype.js", "playwright-core", "ws"]);
});

test("ASSET-USED passes when the page names a listed asset and fails when it draws without any", () => {
  const dir = tmp("lit-asset-used-");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "01-logo.png"), png());
  const treatment = { product: { name: "Rocket", url: repo, assets: [{ path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha(png()) }] } };
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title><p>no logo here</p>");
  const failed = assetUsed(treatment, dir);
  assert.equal(failed.pass, false);
  assert.match(failed.detail, /01-logo\.png/u);
  assert.match(failed.detail, /never a drawn stand-in/u);
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><img src="assets/01-logo.png">');
  const passed = assetUsed(treatment, dir);
  assert.equal(passed.pass, true);
  assert.match(passed.detail, /1 of 1/u);
  assert.equal(assetUsed({ product: { name: "x", url: repo, unreachable: "offline" } }, dir), null);
  assert.equal(assetUsed({}, dir), null);
});

// Review hardening: every hop of an asset fetch is checked for a public address, and a body is cut off
// at its cap while it streams.
test("an asset fetch never follows a redirect into a private or loopback host", async () => {
  const lookup = async (host) => (host === "inside.example" ? [{ address: "10.1.2.3", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
  for (const target of ["https://127.0.0.1:8443/", "https://169.254.169.254/x", "https://inside.example/logo.png", "https://localhost/a.png"]) {
    const seen = [];
    const table = { "https://orbit.example/": { status: 302, body: "", headers: { location: target } } };
    await assert.rejects(fetchAssets({ out: tmp("lit-assets-"), url: "https://orbit.example/", fetchImpl: fakeFetch(table, seen), lookup }), (error) => error.exitCode === 22, target);
    assert.ok(!seen.some(({ url }) => url.startsWith(target.slice(0, 20))), `${target} is never fetched: ${seen.map(({ url }) => url).join(", ")}`);
  }
});

test("an asset body is cut off at its cap while it streams", { timeout: 10_000 }, async () => {
  let pulled = 0;
  const endless = () => new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(256 * 1024)); } });
  const fetchImpl = async () => new Response(endless(), { status: 200, headers: { "content-type": "text/html" } });
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  await assert.rejects(fetchAssets({ out: tmp("lit-assets-"), url: "https://orbit.example/", fetchImpl, lookup }), (error) => error.exitCode === 22);
  assert.ok(pulled * 256 * 1024 < ASSET_LIMITS.pageBytes * 4, `stopped after ${pulled} chunks`);
});
