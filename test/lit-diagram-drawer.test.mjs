import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { expectedInstalledSkillFiles, expectedManagedSkillFiles, managedSkillDefinition } from "../src/cli/managed-skill-assets.ts";
import { runCli } from "../test-support/cli-fixture.ts";

const skillId = "lit-diagram-drawer";
const skillRoot = path.resolve("skills", skillId);
const scriptPath = (name) => path.join(skillRoot, "scripts", name);
const tempRootPrefix = path.join(os.tmpdir(), "litopencode-diagram-");

function runScript(name, args = []) {
  return spawnSync(process.execPath, [scriptPath(name), ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 12 * 1024 * 1024 });
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else files.push(relative);
    }
  }
  await visit(root);
  return files.sort();
}

async function withTempDirectory(callback) {
  const directory = await fs.mkdtemp(tempRootPrefix);
  try { await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function pngChunk(type, data) {
  const kind = Buffer.from(type);
  const body = Buffer.concat([kind, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

function runImporter(name, file, expectedStatus = 0, args = []) {
  const result = spawnSync(process.execPath, [scriptPath(name), file, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, expectedStatus, `${name} ${file}: ${result.stderr}`);
  return expectedStatus === 0 ? JSON.parse(result.stdout) : result;
}

test("diagram workflow is enrolled only through the OpenCode native skill picker", () => {
  const skill = litOpenCode.findLitOpenCodeRuntimeSkill(skillId);
  const feature = litOpenCode.findLitOpenCodeFeature(skillId);
  assert.equal(skill?.title, "Diagram Drawer");
  assert.match(skill?.discovery ?? "", /native skill picker/u);
  assert.deepEqual(skill?.featureIds, [skillId]);
  assert.deepEqual(feature?.bindings.map((binding) => binding.kind), ["config", "cli", "cli"]);
  assert.ok(feature?.bindings.every((binding) => !/slash|chat\.message|command/u.test(`${binding.surface} ${binding.id}`)));
  assert.equal(litOpenCode.litOpenCodeCommands.some((command) => command.id === skillId || command.slash === `/${skillId}`), false);
  for (const text of [skillId, `/${skillId}`, "make a diagram", "draw a workflow", "conceptual system map"]) {
    assert.equal(litOpenCode.detectChatActivationMode(text), undefined, text);
  }
  const help = spawnSync(
    process.execPath,
    [path.resolve("bin/litopencode.cjs"), "--help"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /lit-diagram-drawer creates conceptual, editorial, and technical diagrams/u);
});

test("managed skill closure pins every guide, example, template, tool, font, and license", async () => {
  const definition = managedSkillDefinition(skillId);
  assert.ok(definition);
  const files = await walkFiles(skillRoot);
  assert.deepEqual(files, [...expectedManagedSkillFiles(skillId)].sort());
  assert.deepEqual(expectedInstalledSkillFiles(skillId), expectedManagedSkillFiles(skillId));
  assert.equal(files.filter((file) => file.startsWith("assets/examples/")).length, 183);
  assert.equal(files.filter((file) => /^references\/type-[a-z0-9-]+\.md$/u.test(file)).length, 61);
  assert.equal(files.filter((file) => /^examples\/[^/]+\/after\.html$/u.test(file)).length, 8);
  assert.equal(files.some((file) => /(?:constructed-naive-foil|office-proof\.py|\.png$|\.webp$|^ab\/|^evidence\/)/u.test(file)), false);
  for (const asset of definition.canonicalFiles) {
    const bytes = await fs.readFile(path.join(skillRoot, asset.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.path);
  }
  for (const file of files.filter((name) => /\.(?:md|mjs|json|html)$/u.test(name))) {
    const content = await fs.readFile(path.join(skillRoot, file), "utf8");
    assert.doesNotMatch(content, /plans\/lit-diagram-canonical|(?:^|\/)_refs\/|\/Users\/[^/\s]+\//u, file);
  }
});

test("all packaged templates and accepted examples pass their verifier corpus", () => {
  const coverage = runScript("verify-coverage.mjs", ["--self-test"]);
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.match(coverage.stdout, /COVERAGE_PASS core=41 gallery=61 variants=183 references=61/u);
  const all = runScript("verify-all.mjs");
  assert.equal(all.status, 0, all.stdout + all.stderr);
  const report = JSON.parse(all.stdout);
  assert.deepEqual(report.failures, []);
  assert.equal(report.templates, 183);
  assert.equal(report.afterExamples, 8);
  const brief = runScript("verify-brief.mjs");
  assert.equal(brief.status, 0, brief.stdout + brief.stderr);
  assert.equal(JSON.parse(brief.stdout).checked, 8);

  const foils = fsSync.readdirSync("test/fixtures/lit-diagram-drawer/foils").sort();
  assert.equal(foils.length, 8);
  const expectedFoilFindings = [
    "A11Y_TITLE_DESC_ROLE_LINK",
    "TEXT_OVERLAP",
    "CONTRAST",
    "HUMANIZER_BLOCK",
    "PRETENDARD_FONT_NOT_LOADED_FROM_LOCAL_ASSET"
  ];
  for (const file of foils) {
    const result = runScript("verify-diagram.mjs", [path.resolve("test/fixtures/lit-diagram-drawer/foils", file)]);
    assert.equal(result.status, 1, `${file} should fail visual checks: ${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.startsWith(`DIAGRAM_FAIL ${path.resolve("test/fixtures/lit-diagram-drawer/foils", file)}\n`), file);
    const findings = [...result.stderr.matchAll(/^- ([A-Z][A-Z0-9_]*)/gmu)].map((match) => match[1]);
    assert.deepEqual(findings, expectedFoilFindings, `${file} fails for its expected accessibility, overlap, contrast, detector, and local-font reasons`);
  }
});

test("standalone diagram QA fixtures and importer safety guards are wired into the suite", () => {
  for (const script of [
    "test-visual-quality.mjs",
    "test-sequence-verifier.mjs",
    "test-brief-contract.mjs",
    "test-block-registry.mjs",
    "test-office-safety.mjs"
  ]) {
    const result = runScript(script);
    assert.equal(result.status, 0, `${script}: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /pass/iu, script);
  }
  const importers = runScript("test-importers.mjs");
  assert.equal(importers.status, 0, importers.stdout + importers.stderr);
  assert.match(importers.stdout, /IMPORTER_GUARDS_PASS draw\.io Mermaid Excalidraw bounded stable regular-file no-follow reads/u);
});

test("Node importers preserve inert meaning and reject malformed or active input", async () => {
  await withTempDirectory(async (directory) => {
    const xml = '<mxfile><diagram name="sample"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="src" value="Source &amp; input" vertex="1" parent="1"/><mxCell id="dst" value="Store" vertex="1" parent="1"/><mxCell id="edge" value="HTTPS" edge="1" source="src" target="dst" style="endArrow=block;"/></root></mxGraphModel></diagram></mxfile>';
    const raw = path.join(directory, "raw.drawio");
    await fs.writeFile(raw, xml);
    const imported = runImporter("drawio-extract.mjs", raw);
    assert.equal(imported.nodes.length, 2);
    assert.equal(imported.nodes[0].label, "Source & input");
    assert.equal(imported.relationships.length, 1);
    const model = xml.slice(xml.indexOf("<mxGraphModel>"), xml.indexOf("</mxGraphModel>") + "</mxGraphModel>".length);
    const compressed = path.join(directory, "compressed.drawio");
    const payload = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    await fs.writeFile(compressed, `<mxfile><diagram name="packed">${payload}</diagram></mxfile>`);
    assert.equal(runImporter("drawio-extract.mjs", compressed).title, "packed");
    const escaped = xml.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const svg = path.join(directory, "embedded.drawio.svg");
    await fs.writeFile(svg, `<svg xmlns="http://www.w3.org/2000/svg"><metadata content="${escaped}"/></svg>`);
    assert.equal(runImporter("drawio-extract.mjs", svg).nodes.length, 2);
    const png = path.join(directory, "embedded.drawio.png");
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    await fs.writeFile(png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("tEXt", Buffer.concat([Buffer.from("mxfile\0"), Buffer.from(xml)])), pngChunk("IEND", Buffer.alloc(0))]));
    assert.equal(runImporter("drawio-extract.mjs", png).nodes.length, 2);
    const malicious = path.join(directory, "bad.drawio");
    await fs.writeFile(malicious, '<mxfile><diagram><mxGraphModel><root><mxCell id="a" value="&lt;script&gt;bad&lt;/script&gt;" vertex="1"/></root></mxGraphModel></diagram></mxfile>');
    runImporter("drawio-extract.mjs", malicious, 2);

    const mermaid = path.join(directory, "source.mmd");
    await fs.writeFile(mermaid, "flowchart LR\nA[Input] -->|valid| B{Policy}\nB -->|yes| C[Store]\n");
    assert.equal(runImporter("mermaid-extract.mjs", mermaid).relationships.length, 2);
    const markdown = path.join(directory, "notes.md");
    await fs.writeFile(markdown, "# Model\n\n~~~mermaid\nsequenceDiagram\nparticipant A\nparticipant B\nA->>B: send\n~~~\n");
    assert.equal(runImporter("mermaid-extract.mjs", markdown).suggestedType, "sequence");
    await fs.writeFile(mermaid, "flowchart LR\nA[<script>alert(1)</script>] --> B[Store]\n");
    runImporter("mermaid-extract.mjs", mermaid, 2);
    await fs.writeFile(mermaid, "pie\ntitle unsupported\n");
    runImporter("mermaid-extract.mjs", mermaid, 2);

    const scene = path.join(directory, "scene.excalidraw");
    await fs.writeFile(scene, JSON.stringify({ type: "excalidraw", elements: [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 80, height: 30 },
      { id: "label", type: "text", text: "Input", containerId: "a" },
      { id: "b", type: "ellipse", x: 120, y: 0, width: 80, height: 30 },
      { id: "arrow", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }
    ] }));
    const sceneResult = runImporter("excalidraw-extract.mjs", scene);
    assert.equal(sceneResult.nodes.find((node) => node.id === "a").label, "Input");
    assert.equal(sceneResult.relationships.length, 1);
    await fs.writeFile(scene, JSON.stringify({ type: "excalidraw", elements: [{ id: "x", type: "text", text: "<script>" }] }));
    runImporter("excalidraw-extract.mjs", scene, 2);
    await fs.writeFile(scene, JSON.stringify({ type: "excalidraw", elements: [{ id: "x", type: "rectangle", x: "not-numeric" }] }));
    runImporter("excalidraw-extract.mjs", scene, 2);
  });
});

test("installer copies and doctor validates the selected native skill's complete closure", async () => {
  await withTempDirectory(async (directory) => {
    const install = runCli(["install", "--root", directory]);
    assert.equal(install.status, 0, install.stderr);
    const installed = path.join(directory, "skills", skillId);
    const content = await fs.readFile(path.join(installed, "SKILL.md"), "utf8");
    assert.match(content, /^metadata:\n  litopencodeGenerated: "true"\n  reader_projection: shared_rule$/mu);
    assert.deepEqual(await walkFiles(installed), [...expectedInstalledSkillFiles(skillId)].sort());
    const doctor = runCli(["doctor", "--root", directory]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.ok(report.install.nativeSkills.present.includes(skillId));
    assert.ok(!report.install.nativeSkills.invalid.includes(skillId));
    const tampered = path.join(installed, "references", "type-flowchart.md");
    await fs.appendFile(tampered, "\nchanged\n");
    const tamperDoctor = runCli(["doctor", "--root", directory]);
    assert.equal(tamperDoctor.status, 0, tamperDoctor.stderr);
    assert.ok(JSON.parse(tamperDoctor.stdout).install.nativeSkills.invalid.includes(skillId));
  });
});
