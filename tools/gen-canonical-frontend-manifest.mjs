#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("skills/frontend-ui-ux/references");
const roots = ["design", "designpowers", "perfection", "ui-ux-db"];
const expected = Object.freeze({
  count: 167,
  bytes: 2_596_349,
  digest: "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7"
});
const legal = Object.freeze([
  { path: "_canonical-corpus/LICENSE", sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1" },
  { path: "_canonical-corpus/ATTRIBUTION.md", sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92" },
  { path: "_canonical-corpus/LICENSE-Apache-2.0.txt", sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da" }
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function walk(directory, prefix) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, ...relative.split("/"));
    if (entry.isDirectory()) files.push(...await walk(absolute, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`canonical source contains a symbolic link or special file: ${relative}`);
  }
  return files;
}

const paths = (await Promise.all(roots.map((name) => walk(path.join(root, name), name)))).flat().sort();
const files = [];
for (const relative of paths) {
  const bytes = await fs.readFile(path.join(root, ...relative.split("/")));
  files.push({ path: relative, size: bytes.byteLength, sha256: sha256(bytes) });
}
const count = files.length;
const bytes = files.reduce((sum, file) => sum + file.size, 0);
const digest = sha256(files.map((file) => `${file.sha256}  ${file.path}\n`).join(""));
if (count !== expected.count || bytes !== expected.bytes || digest !== expected.digest) {
  throw new Error(`canonical source invariant mismatch: count=${count} bytes=${bytes} digest=${digest}`);
}
for (const entry of legal) {
  const actual = sha256(await fs.readFile(path.join(root, ...entry.path.split("/"))));
  if (actual !== entry.sha256) throw new Error(`canonical legal mismatch: ${entry.path}`);
}

const manifest = {
  schemaVersion: 1,
  source: {
    commit: "8ec16c5129df7b9778959e8367657d0e79c2c3bb",
    tree: "9188410be0af35f2421ba300d91a0d7a7341caf0"
  },
  roots,
  count,
  bytes,
  digest,
  legal,
  files
};
await fs.writeFile(path.join(root, "_canonical-corpus", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`canonical frontend manifest wrote ${count} files, ${bytes} bytes, ${digest}`);
