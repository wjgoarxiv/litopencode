import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// OpenCode 1 and OpenCode 2 both read the package's `./server` and `./tui` exports, so each entry is one
// object that both hosts accept. These are local copies of the two hosts' checks.
const manifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

function readV1Plugin(mod, kind) {
  const value = mod.default;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`must default export an object with ${kind}()`);
  const server = "server" in value ? value.server : undefined;
  const tui = "tui" in value ? value.tui : undefined;
  if (server !== undefined && typeof server !== "function") throw new TypeError("invalid server export");
  if (tui !== undefined && typeof tui !== "function") throw new TypeError("invalid tui export");
  if (server !== undefined && tui !== undefined) throw new TypeError("either server() or tui(), not both");
  if (kind === "server" && server === undefined) throw new TypeError("must default export an object with server()");
  if (kind === "tui" && tui === undefined) throw new TypeError("must default export an object with tui()");
  return value;
}

function isV2Plugin(value) {
  return typeof value === "object" && value !== null && typeof value.id === "string" && value.id.length > 0 && typeof value.setup === "function";
}

async function load(relative) {
  return import(pathToFileURL(path.resolve(relative)).href);
}

test("package exports point ./server and ./tui at the shared host entries", () => {
  assert.equal(manifest.exports["./server"].import, "./dist/host/server.js");
  assert.equal(manifest.exports["./server"].types, "./dist/host/server.d.ts");
  assert.equal(manifest.exports["./tui"].import, "./dist/host/tui.js");
  assert.equal(manifest.exports["./tui"].types, "./dist/host/tui.d.ts");
  assert.equal(manifest.exports["."].import, "./dist/index.js");
});

test("the server entry satisfies both the OpenCode 1 and the OpenCode 2 loader", async () => {
  const mod = await load("dist/host/server.js");
  assert.deepEqual(Object.keys(mod), ["default"]);
  const entry = readV1Plugin(mod, "server");
  assert.equal(entry.id, "litopencode");
  assert.equal(typeof entry.server, "function");
  assert.equal(entry.tui, undefined);
  assert.ok(isV2Plugin(entry));
});

test("the TUI entry satisfies both the OpenCode 1 and the OpenCode 2 loader", async () => {
  const mod = await load("dist/host/tui.js");
  assert.deepEqual(Object.keys(mod), ["default"]);
  const entry = readV1Plugin(mod, "tui");
  assert.equal(entry.id, "litopencode");
  assert.equal(typeof entry.tui, "function");
  assert.equal(entry.server, undefined);
  assert.ok(isV2Plugin(entry));
});

test("host entries load each host's implementation lazily and ship no runtime import of the OpenCode 2 packages", () => {
  for (const file of ["dist/host/server.js", "dist/host/tui.js"]) {
    const text = fs.readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(text, /^import\s/mu, `${file} has a static import`);
    assert.doesNotMatch(text, /@opencode\//u, file);
    assert.doesNotMatch(text, /\.ts["']/u, `${file} keeps a .ts specifier`);
  }
  for (const file of fs.readdirSync(path.resolve("dist/v2")).filter((name) => name.endsWith(".js"))) {
    const text = fs.readFileSync(path.resolve("dist/v2", file), "utf8");
    assert.doesNotMatch(text, /from ["']@opencode\//u, `dist/v2/${file}`);
    assert.doesNotMatch(text, /from ["']effect["']/u, `dist/v2/${file}`);
  }
});

test("the ./server and ./tui type declarations stand alone: no host plugin package is needed to resolve them", () => {
  // Both host plugin packages are dev dependencies, so a TypeScript consumer of these subpaths would get
  // unresolved imports; the declarations describe the entries structurally instead.
  for (const file of [manifest.exports["./server"].types, manifest.exports["./tui"].types]) {
    const text = fs.readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(text, /["']@opencode(?:-ai)?\//u, file);
    assert.match(text, /\bsetup\(/u, file);
  }
  assert.ok(!Object.keys(manifest.dependencies ?? {}).some((name) => name.startsWith("@opencode")), "no host package became a runtime dependency");
});
