import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { addIconFont, iconFontLine, iconFontPins, planIconFont, removeIconFont } from "../src/cli/icon-font.ts";
import { iconFontInstalled, isIconFontFile } from "../src/round-glyphs.ts";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A small zip with the given entries, stored or deflated. */
function zip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const { name, data, deflate = false } of entries) {
    const body = deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(Buffer.byteLength(name), 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 10);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(Buffer.byteLength(name), 28);
    head.writeUInt32LE(at, 42);
    locals.push(local, Buffer.from(name), body);
    central.push(head, Buffer.from(name));
    at += 30 + Buffer.byteLength(name) + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, directory, end]);
}

const font = Buffer.from("font bytes ".repeat(40));
const licence = Buffer.from("licence text");
const archive = zip([{ name: "README.md", data: Buffer.from("x") }, { name: "SymbolsNerdFontMono-Regular.ttf", data: font, deflate: true }, { name: "LICENSE", data: licence }]);
const pins = {
  ...iconFontPins,
  archiveSha256: sha(archive),
  files: [
    { entry: "SymbolsNerdFontMono-Regular.ttf", name: "SymbolsNerdFontMono-Regular.ttf", sha256: sha(font) },
    { entry: "LICENSE", name: "SymbolsNerdFontMono-LICENSE.txt", sha256: sha(licence) }
  ]
};
const noNetwork = () => assert.fail("the network is not used");

async function place(run, { bytes = archive } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-icon-font-")));
  try {
    const file = path.join(home, "archive.zip");
    fs.writeFileSync(file, bytes);
    const input = { env: { HOME: home, LITOPENCODE_ICON_FONT_ARCHIVE: file }, platform: "linux", homeDir: home, pins, fetch: noNetwork, refresh: async () => {}, systemFolders: [] };
    return await run({ home, input, folder: path.join(home, ".local", "share", "fonts") });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("the pins name the symbols-only font of one release", () => {
  assert.match(iconFontPins.url, /^https:\/\/github\.com\/ryanoasis\/nerd-fonts\/releases\/download\/v3\.5\.1\/NerdFontsSymbolsOnly\.zip$/u);
  assert.equal(iconFontPins.archiveSha256, "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc");
  assert.deepEqual(iconFontPins.files.map(({ name, sha256 }) => [name, sha256]), [
    ["SymbolsNerdFontMono-Regular.ttf", "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749"],
    ["SymbolsNerdFontMono-LICENSE.txt", "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847"]
  ]);
  assert.ok(isIconFontFile(iconFontPins.files[0].name), "the product's own rule sees it afterwards");
  assert.equal(iconFontPins.maxBytes, 8 * 1024 * 1024);
  assert.equal(iconFontPins.timeoutMs, 60_000);
});

test("the plan names file and folder per platform and touches nothing", () => place(async ({ home, input, folder }) => {
  assert.deepEqual(planIconFont(input), { state: "add", folder, files: pins.files.map(({ name }) => name) });
  assert.equal(planIconFont({ ...input, platform: "darwin" }).folder, path.join(home, "Library", "Fonts"));
  assert.equal(planIconFont({ ...input, env: { ...input.env, XDG_DATA_HOME: path.join(home, "data") } }).folder, path.join(home, "data", "fonts"));
  assert.equal(planIconFont({ ...input, platform: "win32" }).state, "unsupported");
  assert.deepEqual(fs.readdirSync(home), ["archive.zip"]);
}));

test("it adds the font and its licence once, owns them, and removes them", () => place(async ({ home, input, folder }) => {
  let refreshed = 0;
  const run = { ...input, refresh: async (at) => { assert.equal(at, folder); refreshed += 1; } };
  const added = await addIconFont(run);
  assert.deepEqual([added.state, added.folder], ["added", folder]);
  assert.deepEqual(fs.readdirSync(folder).sort(), ["SymbolsNerdFontMono-LICENSE.txt", "SymbolsNerdFontMono-Regular.ttf"]);
  assert.deepEqual(fs.readFileSync(path.join(folder, "SymbolsNerdFontMono-Regular.ttf")), font);
  assert.ok(iconFontInstalled([folder]));
  assert.equal(refreshed, 1);
  const manifest = path.join(home, ".litopencode", "icon-font.json");
  assert.equal(JSON.parse(fs.readFileSync(manifest, "utf8")).files.length, 2);
  assert.match(iconFontLine(added), /^ICON_FONT: added SymbolsNerdFontMono-Regular\.ttf in /u);

  assert.equal((await addIconFont({ ...run, env: { HOME: home } })).state, "present", "a second run downloads nothing");
  assert.equal(refreshed, 1);

  const dry = await removeIconFont({ ...input, dryRun: true });
  assert.equal(dry.removed.length, 2);
  assert.equal(fs.readdirSync(folder).length, 2);
  const gone = await removeIconFont(input);
  assert.equal(gone.removed.length, 2);
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.equal(fs.existsSync(manifest), false);
  assert.match(gone.line, /other products may then draw square ends/u);
  assert.match((await removeIconFont(input)).line, /nothing to remove/u);
}));

test("a font of the user is left alone: nothing is added beside it and nothing of it is removed", () => place(async ({ input, folder }) => {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "HackNerdFont-Regular.ttf"), "mine");
  assert.equal((await addIconFont(input)).state, "present");
  await removeIconFont(input);
  assert.deepEqual(fs.readdirSync(folder), ["HackNerdFont-Regular.ttf"]);
}));

test("a changed file stays on removal, and a taken name is never overwritten", () => place(async ({ input, folder }) => {
  await addIconFont(input);
  fs.writeFileSync(path.join(folder, "SymbolsNerdFontMono-Regular.ttf"), "edited");
  const removed = await removeIconFont(input);
  assert.deepEqual([removed.removed.length, removed.kept.length], [1, 1]);
  assert.equal(fs.readFileSync(path.join(folder, "SymbolsNerdFontMono-Regular.ttf"), "utf8"), "edited");

  fs.rmSync(folder, { recursive: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "SymbolsNerdFontMono-LICENSE.txt"), "other text");
  const refused = await addIconFont(input);
  assert.deepEqual([refused.state, refused.reason], ["failed", "that name is taken"]);
  assert.deepEqual(fs.readdirSync(folder), ["SymbolsNerdFontMono-LICENSE.txt"], "nothing half-installed, no staging file");
  assert.equal(fs.readFileSync(path.join(folder, "SymbolsNerdFontMono-LICENSE.txt"), "utf8"), "other text");
}));

test("no link is followed", { skip: process.platform === "win32" }, () => place(async ({ home, input, folder }) => {
  const elsewhere = path.join(home, "elsewhere");
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  fs.symlinkSync(elsewhere, folder);
  assert.deepEqual([(await addIconFont(input)).reason, fs.readdirSync(elsewhere)], ["font folder is a link", []]);
  fs.unlinkSync(folder);
  fs.mkdirSync(folder);
  const target = path.join(home, "target");
  fs.symlinkSync(target, path.join(folder, "SymbolsNerdFontMono-Regular.ttf"));
  assert.equal((await addIconFont(input)).state, "failed");
  assert.equal(fs.existsSync(target), false);
  const linkedArchive = path.join(home, "link.zip");
  fs.symlinkSync(path.join(home, "archive.zip"), linkedArchive);
  fs.unlinkSync(path.join(folder, "SymbolsNerdFontMono-Regular.ttf"));
  assert.equal((await addIconFont({ ...input, env: { ...input.env, LITOPENCODE_ICON_FONT_ARCHIVE: linkedArchive } })).reason, "archive unreadable");
}));

test("a link put at an owned name is not removed", { skip: process.platform === "win32" }, () => place(async ({ home, input, folder }) => {
  await addIconFont(input);
  const file = path.join(folder, "SymbolsNerdFontMono-Regular.ttf");
  fs.renameSync(file, path.join(home, "moved.ttf"));
  fs.symlinkSync(path.join(home, "moved.ttf"), file);
  assert.equal((await removeIconFont(input)).kept.length, 1);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
}));

test("a wrong archive, a wrong file, a damaged zip and an oversized one are refused with a short reason", async () => {
  const wrongFile = zip([{ name: "SymbolsNerdFontMono-Regular.ttf", data: Buffer.from("other") }, { name: "LICENSE", data: licence }]);
  const cases = [
    [Buffer.from("not a zip"), {}, "checksum differs"],
    [wrongFile, { archiveSha256: sha(wrongFile) }, "checksum differs"],
    [Buffer.from("not a zip"), { archiveSha256: sha("not a zip") }, "archive unreadable"],
    [archive, { maxBytes: 100 }, "archive too large"]
  ];
  for (const [bytes, change, reason] of cases) {
    await place(async ({ input, folder }) => {
      const result = await addIconFont({ ...input, pins: { ...pins, ...change } });
      assert.deepEqual([result.state, result.reason], ["failed", reason]);
      assert.equal(fs.existsSync(folder), false, "no folder is made for a font that never comes");
      assert.equal(iconFontLine(result), `ICON_FONT: not installed (${reason})`);
    }, { bytes });
  }
});

test("a download is bounded in time and size, and a failed one never throws", () => place(async ({ home, input, folder }) => {
  const online = { ...input, env: { HOME: home } };
  const asked = [];
  const good = await addIconFont({ ...online, fetch: async (url) => { asked.push(url); return new Response(archive); } });
  assert.deepEqual([good.state, asked], ["added", [iconFontPins.url]]);
  await removeIconFont(input);
  const reasonOf = async (fetch, change = {}) => (await addIconFont({ ...online, fetch, pins: { ...pins, ...change } })).reason;
  assert.equal(await reasonOf(async () => { throw new TypeError("offline"); }), "download failed");
  assert.equal(await reasonOf(async () => new Response("no", { status: 404 })), "download failed");
  assert.equal(await reasonOf(async () => new Response(archive), { maxBytes: 100 }), "archive too large");
  // The deadline's own timer does not keep the process alive; a real connection does, and this one stands in for it.
  const connection = setInterval(() => {}, 5);
  assert.equal(await reasonOf((_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), { timeoutMs: 20 }), "download timed out");
  clearInterval(connection);
  assert.deepEqual(fs.readdirSync(folder), []);
}));

test("Windows gets no font", () => place(async ({ home, input }) => {
  const result = await addIconFont({ ...input, platform: "win32" });
  assert.equal(result.state, "unsupported");
  assert.match(iconFontLine(result), /Windows Terminal and VS Code draw the ends/u);
  assert.deepEqual(fs.readdirSync(home), ["archive.zip"]);
}));
