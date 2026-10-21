import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as motion from "../skills/lit-typographic-motion/engine/command.mjs";
import * as pptx from "../skills/lit-pptx/command.mjs";
import { audioPython } from "../skills/lit-typographic-motion/runtime.mjs";

// The office skills and the motion audio tier each build a venv from hash-pinned wheels, and the pins
// stop at a Python minor version. A python3 that is newer (3.15 on this Mac) fails pip on the first
// package without a wheel, so every venv is built from the newest python3.X on PATH within the range
// the pins cover. An explicit override is used alone: a wrong override is reported, never replaced.
const table = (versions) => (command) => versions[command] === undefined
  ? { ok: false, command, detail: "not found" }
  : { ok: true, command, version: versions[command] };

for (const [label, helpers] of [["motion engine", motion], ["lit-pptx", pptx]]) {
  test(`${label}: passes over a python3 that is 3.15 and takes the newest python3.X in range`, () => {
    const picked = helpers.supportedPython({ min: 10, max: 14, probe: table({ python3: "3.15.0", "python3.15": "3.15.0", "python3.11": "3.11.9", "python3.13": "3.13.4" }) });
    assert.deepEqual([picked.ok, picked.command, picked.version], [true, "python3.13", "3.13.4"]);
  });

  test(`${label}: an override is used alone, and no supported Python names what was tried`, () => {
    const wrong = helpers.supportedPython({ min: 10, max: 14, override: "/opt/py/bin/python3", probe: table({ "/opt/py/bin/python3": "3.15.0", "python3.13": "3.13.4" }) });
    assert.equal(wrong.ok, false);
    assert.match(wrong.detail, /\/opt\/py\/bin\/python3: 3\.15\.0 is newer than 3\.14/u);
    const none = helpers.supportedPython({ min: 10, max: 14, probe: table({ python3: "3.15.0" }) });
    assert.equal(none.ok, false);
    assert.match(none.detail, /no supported Python \(3\.10 to 3\.14\).*python3: 3\.15\.0 is newer than 3\.14/u);
  });
}

test("motion audio picks from the audio pins' range with the same rule, MOTION_PYTHON alone when set", () => {
  const versions = { python3: "3.15.0", "python3.14": "3.14.7", "python3.13": "3.13.4", "python3.11": "3.11.9" };
  assert.equal(audioPython({}, table(versions)).command, "python3.13");
  assert.throws(() => audioPython({ MOTION_PYTHON: "python3.14" }, table(versions)), /python3\.14: 3\.14\.7 is newer than 3\.13/u);
  assert.throws(() => audioPython({}, table({ python3: "3.15.0" })), /no supported Python \(3\.12 to 3\.13\)/u);
  assert.throws(() => audioPython({}, table({ python3: "3.11.9", "python3.11": "3.11.9" })), /no supported Python \(3\.12 to 3\.13\).*python3: 3\.11\.9 is older than 3\.12/u);
});

// A fake interpreter: answers the version probe, and logs any other call (such as `-m venv`) and fails.
function fakePython(dir, name, version, log) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = "-c" ]; then echo ${version}; exit 0; fi\necho "${name} $*" >> "${log}"\nexit 1\n`, { mode: 0o755 });
}

function fakePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-python-pick-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const log = path.join(dir, "calls.log");
  fakePython(bin, "python3", "3.15.0", log);
  fakePython(bin, "python3.13", "3.13.4", log);
  return { dir, bin, log, env: { PATH: bin, HOME: dir, XDG_CACHE_HOME: path.join(dir, "cache"), PIP_NO_INDEX: "1" } };
}

test("lit-pptx builds its office venv from python3.13 when python3 on PATH is 3.15", { skip: process.platform === "win32" && "POSIX shell fakes" }, () => {
  const fake = fakePath();
  try {
    const result = spawnSync(process.execPath, [path.resolve("skills/lit-pptx/run.mjs"), "qa", "deck.pptx"], { env: { ...fake.env, PATH: `${fake.bin}${path.delimiter}${path.dirname(process.execPath)}` }, encoding: "utf8", timeout: 30000 });
    assert.notEqual(result.status, 0, "the fake venv fails, so the run stops");
    assert.deepEqual(fs.readFileSync(fake.log, "utf8").trim().split("\n").map((line) => line.split(" ").slice(0, 3).join(" ")), [`python3.13 -m venv`]);
  } finally {
    fs.rmSync(fake.dir, { recursive: true, force: true });
  }
});

test("lit-docx builds its office venv from python3.13 when python3 on PATH is 3.15", { skip: process.platform === "win32" && "POSIX shell fakes" }, (t) => {
  const interpreter = ["python3.14", "python3.13", "python3.12", "python3.11", "python3.10", "python3"].find((name) => spawnSync(name, ["-c", ""]).status === 0);
  if (interpreter === undefined) return t.skip("no Python to run run.py with");
  const fake = fakePath();
  try {
    const real = spawnSync(interpreter, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
    const result = spawnSync(real, [path.resolve("skills/lit-docx/run.py"), "lint", "doc.md"], { env: { ...fake.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 30000 });
    assert.notEqual(result.status, 0, "the fake venv fails, so the run stops");
    assert.deepEqual(fs.readFileSync(fake.log, "utf8").trim().split("\n").map((line) => line.split(" ").slice(0, 3).join(" ")), [`python3.13 -m venv`]);
  } finally {
    fs.rmSync(fake.dir, { recursive: true, force: true });
  }
});
