import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { createCommandActivationHook } from "../src/commands.ts";
import { runCli } from "../test-support/cli-fixture.ts";

const skillId = "lit-scientific-visualization";
const banner = "🔥 LIT IGNITED · lit-scientific-visualization 🔥";
const canonicalPrefix = "scientific-visualization/";
const canonicalManifestHash = "5a01a2768a1b29d4820bdc895fb7cb75c329110fd711de8fd07bdeaa1e42b9ab";
const canonicalAssets = new Map([
  ["SKILL.md", "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68"],
  ["assets/color_palettes.py", "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309"],
  ["assets/nature.mplstyle", "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6"],
  ["assets/presentation.mplstyle", "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339"],
  ["assets/publication.mplstyle", "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea"],
  ["evals/evals.json", "366dc61b6e042f08f28bf33f2534feea80219d771b84497ec7094b30263e935b"],
  ["references/color_palettes.md", "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa"],
  ["references/journal_requirements.md", "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7"],
  ["references/matplotlib_examples.md", "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d"],
  ["references/mdanalysis_martini_visualization.md", "abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe"],
  ["references/publication_guidelines.md", "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c"],
  ["references/seaborn_for_publications.md", "2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a"],
  ["scripts/figure_export.py", "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403"],
  ["scripts/style_presets.py", "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4"],
  ["tests/test_figure_export.py", "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e"],
  ["tests/test_style_presets.py", "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46"]
]);

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-sciviz-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("canonical scientific-visualization mirror preserves the exact tracked manifest", async () => {
  const records = [];
  for (const [relativePath, expectedHash] of canonicalAssets) {
    const packaged = await fs.readFile(path.join("vendor", "scientific-visualization", relativePath));
    assert.equal(sha256(packaged), expectedHash, relativePath);
    records.push(`${expectedHash}  ${canonicalPrefix}${relativePath}\n`);
  }

  assert.equal(sha256(records.join("")), canonicalManifestHash);
  const mirroredFiles = [];
  async function walk(dir, prefix = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else mirroredFiles.push(relative);
    }
  }
  await walk(path.join("vendor", "scientific-visualization"));
  assert.deepEqual(mirroredFiles.sort(), [...canonicalAssets.keys()].sort());
  assert.equal(mirroredFiles.some((file) => file.endsWith(".pyc") || file.includes("__pycache__")), false);
});

test("scientific-visualization adapter publishes MIT provenance and CP/SDS notice", async () => {
  const license = await fs.readFile(path.join("vendor", "licenses", "045_scientific-visualization-MIT.txt"), "utf8");
  const notice = await fs.readFile(path.join("vendor", "NOTICE.md"), "utf8");
  const provenance = await fs.readFile(path.join("vendor", "provenance", "045_scientific-visualization.md"), "utf8");
  const readme = await fs.readFile("README.md", "utf8");

  assert.match(license, /MIT License/);
  assert.match(notice, /CP\/SDS/);
  assert.match(notice, /Okabe|Ito|Wong|Paul Tol/);
  assert.match(provenance, /045_scientific-visualization/);
  assert.match(provenance, new RegExp(canonicalManifestHash));
  assert.match(readme, /\/lit-scientific-visualization/);
});

test("scientific visualization is enrolled in native catalogs and exact slash route", () => {
  const skill = litOpenCode.findLitOpenCodeRuntimeSkill(skillId);
  const feature = litOpenCode.findLitOpenCodeFeature(skillId);
  const command = litOpenCode.litOpenCodeCommands.find((candidate) => candidate.id === skillId);

  assert.equal(skill?.title, "Scientific Visualization");
  assert.deepEqual(skill?.featureIds, [skillId, "doctor-install"]);
  assert.equal(feature?.id, skillId);
  assert.equal(command?.slash, `/${skillId}`);
  assert.equal(command?.banner, banner);
  assert.equal(command?.activationText.startsWith(`${banner}\n`), true);
  assert.ok(command?.activationText.includes("🔥 **LIT IGNITED · lit-scientific-visualization** 🔥"));
  assert.match(command?.activationText ?? "", /exact_source_root: \.\/canonical/);
  assert.match(command?.activationText ?? "", /rcparams\(\)/);
});

test("scientific visualization keeps generic and near-miss chat text inert", () => {
  for (const text of [
    "visualization",
    "scientific visualization",
    "scientific-visualization",
    "please create a visualization",
    "please lit-scientific-visualization",
    "`lit-scientific-visualization`",
    "/lit-scientific-visualization"
  ]) {
    assert.equal(litOpenCode.detectChatActivationMode(text), undefined, text);
  }
});

test("/lit-scientific-visualization injects the exact first banner", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    const output = { parts: [] };

    await hook({ command: `/${skillId}`, sessionID: "session-sciviz", arguments: "private dataset" }, output);

    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].text.startsWith(`${banner}\n`), true);
    assert.equal(output.parts[0].metadata.litopencode.mode, skillId);
    const ledger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.doesNotMatch(ledger, /private dataset/);
  });
});

test("installer preserves scientific discovery metadata and doctor verifies source and installed closure", async () => {
  await withTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);

    const installedAdapter = await fs.readFile(path.join(dir, "skills", skillId, "SKILL.md"), "utf8");
    assert.match(installedAdapter, /^metadata:\n  litopencodeGenerated: "true"$/m);
    assert.doesNotMatch(installedAdapter, /^litopencodeGenerated: true$/m);
    assert.match(installedAdapter, /an exact bare `lit-scientific-visualization`/);
    assert.doesNotMatch(installedAdapter, /Trigger when the user asks for scientific visualization/i);

    await assert.rejects(fs.stat(path.join(dir, "skills", skillId, "original")), { code: "ENOENT" });

    const firstDoctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.deepEqual(firstDoctor.install.nativeSkills.invalid, []);
    assert.equal(firstDoctor.install.nativeSkills.dependencies[skillId].autoInstall, false);

    await assert.rejects(fs.stat(path.join(dir, "skills", skillId, "original", "scripts", "local.pyc")), { code: "ENOENT" });
  });
});

test("doctor reports missing Python capability as DEGRADED without failing install integrity", async () => {
  await withTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    const emptyPath = path.join(dir, "empty-path");
    await fs.mkdir(emptyPath);

    const doctor = runCli(["doctor", "--root", dir], { env: { ...process.env, PATH: emptyPath } });
    assert.equal(doctor.status, 0, doctor.stderr);
    const output = JSON.parse(doctor.stdout);
    const dependency = output.install.nativeSkills.dependencies[skillId];
    assert.equal(output.install.nativeSkills.ok, true);
    assert.equal(output.install.ok, true);
    assert.equal(dependency.status, "DEGRADED");
    assert.equal(dependency.autoInstall, false);
    assert.ok(dependency.required.missing.includes("python3"));
    assert.ok(dependency.required.missing.includes("matplotlib"));
  });
});

test("dependency probe uses the explicit interpreter and actual imports", async () => {
  await withTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    const interpreter = path.join(dir, "python-probe");
    await fs.writeFile(
      interpreter,
      [
        "#!/bin/sh",
        "case \"$2\" in",
        "  *import_module*) matplotlib=false ;;",
        "  *) matplotlib=true ;;",
        "esac",
        "printf '%s\\n' \"{\\\"version\\\":\\\"probe-1\\\",\\\"modules\\\":{\\\"matplotlib\\\":$matplotlib}}\""
      ].join("\n") + "\n",
      { mode: 0o755 }
    );

    const doctor = runCli(["doctor", "--root", dir], {
      env: { ...process.env, LITOPENCODE_SCIENTIFIC_PYTHON: interpreter }
    });
    assert.equal(doctor.status, 0, doctor.stderr);
    const dependency = JSON.parse(doctor.stdout).install.nativeSkills.dependencies[skillId];
    assert.equal(dependency.interpreter.command, interpreter);
    assert.equal(dependency.interpreter.available, true);
    assert.equal(dependency.interpreter.version, "probe-1");
    assert.equal(dependency.status, "DEGRADED");
    assert.deepEqual(dependency.required.missing, ["matplotlib"]);
  });
});

test("installer preserves a pre-existing scientific command alias and reports the collision", async () => {
  await withTempDir(async (dir) => {
    const alias = path.join(dir, "command", `${skillId}.md`);
    const custom = "---\ndescription: user-owned route\n---\nDo not replace.\n";
    await fs.mkdir(path.dirname(alias), { recursive: true });
    await fs.writeFile(alias, custom);

    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    assert.equal(await fs.readFile(alias, "utf8"), custom);
    const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.ok(doctor.install.commandAliases.preserved.includes(skillId));
  });
});

test("installer preserves a user-owned scientific visualization collision", async () => {
  await withTempDir(async (dir) => {
    const custom = `---\nname: ${skillId}\n---\n# User-owned visualization\n`;
    const entrypoint = path.join(dir, "skills", skillId, "SKILL.md");
    await fs.mkdir(path.dirname(entrypoint), { recursive: true });
    await fs.writeFile(entrypoint, custom);

    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    assert.equal(await fs.readFile(entrypoint, "utf8"), custom);
    await assert.rejects(fs.stat(path.join(dir, "skills", skillId, "original")), { code: "ENOENT" });
    const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.ok(doctor.install.nativeSkills.present.includes(skillId));
    assert.ok(doctor.install.nativeSkills.preserved.includes(skillId));
    assert.deepEqual(doctor.install.nativeSkills.invalid, []);
  });
});
