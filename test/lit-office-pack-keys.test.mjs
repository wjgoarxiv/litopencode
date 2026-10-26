import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

// Every key in a deck tonality pack or a document tonality file reads as a promise, so the engine has to
// read it. A key counts as read when an engine script names it as `.key` or as the quoted "key" (a lookup,
// or a key list the loader checks). A nested key counts only in a script that also names its parent, so
// a field of the same name elsewhere does not count. A key no script reads is either listed here, with
// the reason it may stay, or removed from the packs together with the reference sentences that describe it.
const allowed = {
  "lit-pptx": {
    avoid: "mirrors the Avoid list of references/tonalities/<id>.md, which the model reads while writing; the engine has no switch for it",
    "table.style": "names the table style the reference describes; header, header-ink, rules, banding and totals draw it (the hard-edge packs set those directly and name none)"
  },
  "lit-docx": {}
};

function engineSource(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((file) => /\.(?:c?js|mjs|py)$/u.test(file))
    .map((file) => readFileSync(join(dir, file), "utf8"));
}

function keyPaths(value, prefix = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [[...prefix, key], ...keyPaths(child, [...prefix, key])]);
}

function names(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<=[\\w)\\]])\\.${escaped}(?![\\w-])|["']${escaped}["']`, "u").test(source);
}

function unread(skill, packFiles) {
  const sources = engineSource(`skills/${skill}/scripts`);
  const paths = new Map();
  for (const file of packFiles) {
    for (const keyPath of keyPaths(parse(readFileSync(file, "utf8")))) paths.set(keyPath.join("."), keyPath);
  }
  return [...paths].filter(([, keyPath]) => {
    const key = keyPath.at(-1);
    const parent = keyPath.at(-2);
    return !sources.some((source) => names(source, key) && (parent === undefined || names(source, parent)));
  }).map(([dotted]) => dotted).filter((dotted) => allowed[skill][dotted] === undefined).sort();
}

test("every deck tonality pack key is read by the deck engine or allowed with a reason", () => {
  const root = "skills/lit-pptx/templates/tonalities";
  const packs = readdirSync(root).map((id) => join(root, id, "pack.yaml"));
  assert.equal(packs.length, 13);
  assert.deepEqual(unread("lit-pptx", packs), []);
});

test("every document tonality key is read by the document engine or allowed with a reason", () => {
  const root = "skills/lit-docx/templates/tonalities";
  const files = readdirSync(root).filter((file) => file.endsWith(".yaml")).map((file) => join(root, file));
  assert.equal(files.length, 6);
  assert.deepEqual(unread("lit-docx", files), []);
});

test("the allowed keys still exist, so the list cannot outlive them", () => {
  const deck = readdirSync("skills/lit-pptx/templates/tonalities")
    .map((id) => parse(readFileSync(join("skills/lit-pptx/templates/tonalities", id, "pack.yaml"), "utf8")));
  for (const dotted of Object.keys(allowed["lit-pptx"])) {
    assert.ok(deck.some((pack) => dotted.split(".").reduce((node, key) => node?.[key], pack) !== undefined), dotted);
  }
});
