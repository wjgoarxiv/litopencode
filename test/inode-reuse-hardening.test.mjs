import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { captureKnowledgeEvent, queryKnowledge, reviewKnowledgeRecord } from "../src/knowledge.ts";

function spoofStat(stat, fields) {
  return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, fields);
}

async function removeDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

function knowledgeEvent(text, source) {
  return { kind: "decision", text, evidenceRef: "docs/inode-reuse.md:1", source };
}

async function captureAccepted(root, text, source) {
  const captured = await captureKnowledgeEvent(root, knowledgeEvent(text, source), { surface: "tool.wikify" });
  assert.equal(captured.status, "captured");
  const accepted = await reviewKnowledgeRecord(root, {
    id: captured.record.id,
    state: "accepted",
    surface: "tool.wikify.save"
  });
  assert.equal(accepted.status, "updated");
}

test("SIM-F knowledge authority replacement is rejected, while a newly rotated authority is readable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-knowledge-inode-"));
  try {
    await captureAccepted(root, "The original authority remains bounded.", "original-source");
    const paths = (await import("../src/knowledge.ts")).knowledgePaths(root);
    const originalBytes = await fs.readFile(paths.claimsFile);
    await captureAccepted(root, "The replacement authority is also bounded.", "replacement-source");
    const replacementBytes = await fs.readFile(paths.claimsFile);
    await fs.writeFile(paths.claimsFile, originalBytes, { mode: 0o600 });
    const originalStat = await fs.lstat(paths.claimsFile);
    const oldFields = { dev: Number(originalStat.dev), ino: Number(originalStat.ino) };
    let swapped = false;
    const originalLstat = fs.lstat;
    const originalOpen = fs.open;
    mock.method(fs, "lstat", async (file, ...args) => {
      const observed = await originalLstat(file, ...args);
      if (swapped && path.resolve(String(file)) === paths.claimsFile) return spoofStat(observed, oldFields);
      return observed;
    });
    mock.method(fs, "open", async (file, ...args) => {
      if (!swapped && path.resolve(String(file)) === paths.claimsFile) {
        swapped = true;
        await fs.rename(paths.claimsFile, `${paths.claimsFile}.old`);
        await fs.writeFile(paths.claimsFile, replacementBytes, { mode: 0o600 });
      }
      const handle = await originalOpen(file, ...args);
      if (path.resolve(String(file)) !== paths.claimsFile || !swapped) return handle;
      const originalStatMethod = handle.stat.bind(handle);
      handle.stat = async (...statArgs) => spoofStat(await originalStatMethod(...statArgs), oldFields);
      return handle;
    });
    try {
      await assert.rejects(queryKnowledge(root, "replacement authority"), /changed|unsafe|identity/iu);
      assert.equal(swapped, true);
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
    const readable = await queryKnowledge(root, "replacement authority");
    assert.equal(readable.records.length, 2);
  } finally {
    await removeDirectory(root);
  }
});

function pythonPublicationProbe(relativeScript) {
  return `
import importlib.util, json, os, pathlib, shutil, tempfile
script_path = pathlib.Path(${JSON.stringify(relativeScript)}).resolve()
spec = importlib.util.spec_from_file_location("probe_module", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = pathlib.Path(tempfile.mkdtemp(prefix="litopencode-publish-inode-"))
output = root / "output"
output.mkdir()
(output / "marker.txt").write_text("ORIGINAL\\n", encoding="utf-8")
held = root / "held"
real_lstat = pathlib.Path.lstat
old = real_lstat(output)
state = {"swapped": False}
def simulated_lstat(self):
    observed = real_lstat(self)
    if state["swapped"] and self == output:
        class ReusedStat:
            def __getattr__(self, name):
                if name == "st_dev": return old.st_dev
                if name == "st_ino": return old.st_ino
                return getattr(observed, name)
        return ReusedStat()
    return observed
pathlib.Path.lstat = simulated_lstat
def populate(stage):
    os.rename(output, held)
    output.mkdir()
    (output / "marker.txt").write_text("REPLACEMENT\\n", encoding="utf-8")
    (stage / "generated.txt").write_text("GENERATED\\n", encoding="utf-8")
state["swapped"] = True
try:
    module.atomic_publish(output, populate)
    print(json.dumps({"accepted": True, "marker": (output / "marker.txt").read_text(encoding="utf-8")}))
except Exception as error:
    print(json.dumps({"accepted": False, "error": str(error), "marker": (output / "marker.txt").read_text(encoding="utf-8")}))
pathlib.Path.lstat = real_lstat
module.atomic_publish(output, lambda stage: (stage / "authorized.txt").write_text("AUTHORIZED\\n", encoding="utf-8"))
print(json.dumps({"authorized": True, "marker": (output / "marker.txt").read_text(encoding="utf-8")}))
shutil.rmtree(root)
`;
}

test("SIM-P both publication scripts reject a reused output and accept a normal publish", () => {
  for (const script of [
    "skills/autoconference/scripts/init_conference.py",
    "skills/autoresearch/scripts/init_research.py"
  ]) {
    const result = spawnSync("python3", ["-c", pythonPublicationProbe(script)], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].accepted, false, `${script} accepted a reused output: ${result.stdout}`);
    assert.match(lines[0].error, /identity changed/u);
    assert.equal(lines[0].marker, "REPLACEMENT\n");
    assert.equal(lines[1].authorized, true);
  }
});
