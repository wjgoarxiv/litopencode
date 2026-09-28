// allow: SIZE_OK - one packed-artifact SUT shares a single authoritative pack/extract lifecycle.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createBetaMaterialEvidence, validBetaDesignContract } from "../test-support/uiux-visual-fixtures.mjs";
import { canonicalHandoffAssets } from "../test-support/lit-handoff-fixture.mjs";
import { importInstalledPalette, assertRetainedCaches } from "../test-support/native-canonical-fixture.mjs";
import { seedPackedRuntimeDependencies } from "../test-support/packed-runtime-dependencies.mjs";

const packageManifest = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8"));
const packageVersion = packageManifest.version;
const packageId = `@litfamily/litopencode@${packageVersion}`;
const archiveName = `litfamily-litopencode-${packageVersion}.tgz`;
const runtimeDependencyNames = Object.keys(packageManifest.dependencies ?? {});

async function withTempDir(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-packed-artifact-")));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
}

async function seedConsumerRuntimeDependencies(consumer) {
  for (const dependencyName of runtimeDependencyNames) {
    const segments = dependencyName.split("/");
    const source = path.resolve("node_modules", ...segments);
    const sourceStat = await fs.lstat(source);
    assert.equal(sourceStat.isDirectory(), true, `missing installed runtime dependency: ${dependencyName}`);
    const target = path.join(consumer, "node_modules", ...segments);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(source, target, process.platform === "win32" ? "junction" : "dir");
  }
}

async function packAndExtract(dir) {
  const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", dir]);
  assert.equal(pack.status, 0, pack.stderr);
  const archivePath = path.join(dir, archiveName);
  const extract = run("tar", ["-xzf", archivePath, "-C", dir]);
  assert.equal(extract.status, 0, extract.stderr);
  const packageDir = path.join(dir, "package");
  await seedPackedRuntimeDependencies(packageDir);
  return packageDir;
}

test("packed canonical skill corpora resolve from native install and survive normal use", async (t) => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packageSkill = path.join(packageDir, "skills", "lit-handoff");
    const packageVendor = path.join(packageDir, "vendor", "handoff");
    const expectedFiles = ["SKILL.md"];
    const packedFiles = [];

    async function walk(directory, prefix = "") {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
        else packedFiles.push(relative);
      }
    }

    await walk(packageSkill);
    assert.deepEqual(packedFiles.sort(), expectedFiles.sort());
    for (const [relativePath, expectedHash] of canonicalHandoffAssets) {
      const bytes = await fs.readFile(path.join(packageVendor, relativePath));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, relativePath);
    }

    const home = dir;
    const root = path.join(home, "installed OpenCode root");
    const project = path.join(home, "project");
    const tmp = path.join(home, "tmp");
    await Promise.all([project, tmp].map((directory) => fs.mkdir(directory)));
    const env = {
      HOME: home, USERPROFILE: home, TMPDIR: tmp, PATH: process.env.PATH,
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"), XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      LITOPENCODE_NO_AUTO_UPDATE: "1", NO_UPDATE_NOTIFIER: "1", LITOPENCODE_MOTION_PREWARM: "off",
      NODE_OPTIONS: "--max-old-space-size=512"
    };
    const cli = path.join(packageDir, "bin", "litopencode.cjs");
    const install = run(process.execPath, [cli, "install", "--root", root, "--no-model-prompt", "--no-auto-update"], { env, cwd: project, timeout: 30000 });
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const doctor = run(process.execPath, [cli, "doctor", "--root", root, "--json", "--no-auto-update"], { env, cwd: project, timeout: 30000 });
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.install.nativeSkills.ok, true);
    assert.ok(report.install.nativeSkills.managed.includes("lit-handoff"));
    assert.equal(report.install.nativeSkills.invalidAssets.some((asset) => asset.startsWith("lit-handoff/")), false);

    await assert.rejects(fs.stat(path.join(root, "skills", "lit-handoff", "original")), { code: "ENOENT" });
    const managed = JSON.parse(await fs.readFile(path.join(packageDir, "skills", "managed-skill-manifest.json"), "utf8"));
    for (const id of ["lit-handoff", "lit-scientific-visualization"]) {
      const wrapperRoot = path.join(root, "skills", id);
      const wrapper = await fs.readFile(path.join(wrapperRoot, "SKILL.md"), "utf8");
      const declaration = /^exact_source_root: (.+)$/m.exec(wrapper)?.[1];
      assert.ok(declaration);
      const canonical = path.resolve(wrapperRoot, declaration);
      assert.ok(canonical.startsWith(wrapperRoot + path.sep), "actual installed closure must not depend on extracted package location");
      for (const asset of managed.skills[id].canonicalFiles) {
        assert.equal(createHash("sha256").update(await fs.readFile(path.join(canonical, asset.path))).digest("hex"), asset.sha256, `${id}/${asset.path}`);
      }
    }
    await t.test("actual packed CLI normal import, doctor, repeat and retained bytecode hashes", async (t) => {
      const imported = await importInstalledPalette({ root, env, project }, t);
      if (imported === null) return;
      const doctor = run(process.execPath, [cli, "doctor", "--root", root, "--json", "--no-auto-update"], { env, cwd: project, timeout: 30000 });
      assert.equal(doctor.status, 0, doctor.stderr);
      assert.equal(JSON.parse(doctor.stdout).install.nativeSkills.ok, true);
      const repeat = run(process.execPath, [cli, "install", "--root", root, "--yes", "--no-auto-update"], { env, cwd: project, timeout: 30000 });
      assert.equal(repeat.status, 0, repeat.stderr);
      await assertRetainedCaches(root, imported.canonical, [{ path: imported.cache, bytes: imported.bytes }]);
    });
  });
});

function workflowNameDeclarations(markdown) {
  return markdown
    .split("\n")
    .filter((line) =>
      /^- (?:current |historic )?(?:planning\/research )?workflow names:/i.test(line) ||
      /^(?:Lit-family vocabulary is retained|Current workflow names):/i.test(line)
    )
    .map((line) => ({
      historic: /^- historic /i.test(line),
      ids: [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      line
    }));
}

function stablePackedRecordId(record) {
  return `kn_${createHash("sha256").update(JSON.stringify([
    record.kind,
    record.text.toLocaleLowerCase("en-US"),
    record.evidence.ref,
    record.provenance.source
  ])).digest("hex").slice(0, 24)}`;
}

test("packed Wikify rejects prefixed and long-scheme credential URI userinfo", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    const root = path.join(dir, "packed credential uri project");
    await fs.mkdir(root);
    const event = (overrides = {}) => ({
      kind: "decision",
      text: "Use claims.jsonl as the only knowledge authority.",
      evidenceRef: "docs/architecture.md:42",
      source: "wikify-tool",
      ...overrides
    });
    for (const text of [
      "Read prefix_https://alice:secret@example.com/private.",
      `Read ${"s".repeat(33)}://alice:secret@example.com/private.`
    ]) {
      const result = await packed.captureKnowledgeEvent(root, event({ text }), { surface: "tool.wikify" });
      assert.equal(result.status, "rejected", text);
    }

    const captured = await packed.captureKnowledgeEvent(root, event(), { surface: "tool.wikify" });
    assert.equal(captured.status, "captured");
    const reviewed = await packed.reviewKnowledgeRecord(root, {
      id: captured.record.id,
      state: "accepted",
      surface: "tool.wikify.save"
    });
    assert.equal(reviewed.status, "updated");
    const paths = packed.knowledgePaths(root);
    const persisted = JSON.parse((await fs.readFile(paths.claimsFile, "utf8")).trim().split("\n").at(-1));
    const hook = packed.createChatMessageActivationHook(root);
    for (const text of [
      "Read prefix_https://alice:secret@example.com/private knowledge authority",
      `Read ${"s".repeat(33)}://alice:secret@example.com/private knowledge authority`
    ]) {
      const forged = { ...persisted, text, id: stablePackedRecordId({ ...persisted, text }) };
      await fs.writeFile(paths.claimsFile, `${JSON.stringify(forged)}\n`);
      await assert.rejects(packed.queryKnowledge(root, "knowledge authority"), /credential|userinfo|unsafe|Malformed knowledge claim/iu, text);
      const output = {
        message: { id: "msg-packed-credential-uri" },
        parts: [{ id: "part-packed-credential-uri", type: "text", text: "Where is the knowledge authority stored?" }]
      };
      await hook({ sessionID: "session-packed-credential-uri", messageID: "msg-packed-credential-uri", agent: "lit-loop" }, output);
      assert.equal(output.parts.length, 1, text);
    }
  });
});

test("packed artifact probes do not rebuild shared dist during concurrent tests", async () => {
  await withTempDir(async (dir) => {
    const sharedDistFiles = [
      path.resolve("dist", "agents", "specialists.js"),
      path.resolve("dist", "cli", "install-report.js"),
      path.resolve("dist", "cli", "scientific-visualization-dependencies.js")
    ];
    const before = await Promise.all(sharedDistFiles.map(async (filePath) => (await fs.stat(filePath, { bigint: true })).mtimeNs));

    await packAndExtract(dir);

    const after = await Promise.all(sharedDistFiles.map(async (filePath) => (await fs.stat(filePath, { bigint: true })).mtimeNs));
    assert.deepEqual(after, before);
  });
});

test("packed canonical verifier runs through documented Node command from a path with spaces", async () => {
  await withTempDir(async (dir) => {
    const spacedRoot = path.join(dir, "packed install with spaces");
    await fs.mkdir(spacedRoot);
    const packageDir = await packAndExtract(spacedRoot);
    const skillRoot = path.join(packageDir, "skills", "frontend-ui-ux");
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    assert.match(skill, /`node scripts\/verify-canonical-corpus\.mjs --json`/u);
    const result = run(process.execPath, ["scripts/verify-canonical-corpus.mjs", "--json"], { cwd: skillRoot });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.count, 167);
  });
});

test("packed canonical verifier rejects an explicit symlinked references root", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const skillRoot = path.join(packageDir, "skills", "frontend-ui-ux");
    const references = path.join(skillRoot, "references");
    const linkedRoot = path.join(dir, "linked packed references");
    await fs.symlink(references, linkedRoot);
    const result = run(process.execPath, [path.join(skillRoot, "scripts", "verify-canonical-corpus.mjs"), "--root", linkedRoot, "--json"]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).error, /references root.*symbolic link/iu);
  });
});

test("packed text contains no maintainer user-profile absolute paths", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const offenders = [];
    const absoluteProfile = /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/])/u;
    async function walk(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const bytes = await fs.readFile(absolute);
          if (!bytes.includes(0) && absoluteProfile.test(bytes.toString("utf8"))) {
            offenders.push(path.relative(packageDir, absolute).split(path.sep).join("/"));
          }
        }
      }
    }
    await walk(packageDir);
    assert.deepEqual(offenders, [], `packed user-profile absolute paths: ${offenders.join(", ")}`);
  });
});

test("packed-installed canonical verifier enforces the strict CLI grammar", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, archiveName);
    const consumer = path.join(dir, "consumer with spaces");
    const installedRoot = path.join(dir, "installed OpenCode root with spaces");
    const isolatedHome = path.join(dir, "isolated home");
    const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", dir]);
    assert.equal(pack.status, 0, pack.stderr);
    await fs.mkdir(consumer);
    await fs.mkdir(isolatedHome);
    assert.equal(run("npm", ["init", "-y"], { cwd: consumer }).status, 0);
    await seedConsumerRuntimeDependencies(consumer);
    const installPackage = run("npm", ["install", "--omit=dev", "--ignore-scripts", archivePath], {
      cwd: consumer,
      env: { ...process.env, HOME: isolatedHome }
    });
    assert.equal(installPackage.status, 0, installPackage.stderr);
    const cli = path.join(consumer, "node_modules", ".bin", "litopencode");
    const installPlugin = run(cli, ["install", "--root", installedRoot, "--no-model-prompt"], {
      cwd: consumer,
      env: { ...process.env, HOME: isolatedHome, XDG_CONFIG_HOME: path.join(isolatedHome, "xdg") }
    });
    assert.equal(installPlugin.status, 0, installPlugin.stderr);

    const skillRoot = path.join(installedRoot, "skills", "frontend-ui-ux");
    const verifier = path.join(skillRoot, "scripts", "verify-canonical-corpus.mjs");
    for (const args of [["--json"], ["--root", path.join(skillRoot, "references"), "--json"]]) {
      const result = run(process.execPath, [verifier, ...args], { cwd: consumer });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).count, 167);
    }

    const invalid = [
      [["--root"], /--root requires one path value/iu],
      [["--unknown"], /unknown option.*--unknown/iu],
      [["--json", "--json"], /duplicate option.*--json/iu],
      [["--root", path.join(skillRoot, "references"), "--root", path.join(skillRoot, "references")], /duplicate option.*--root/iu],
      [["unexpected"], /unexpected positional argument.*unexpected/iu]
    ];
    for (const [args, pattern] of invalid) {
      const result = run(process.execPath, [verifier, ...args], { cwd: consumer });
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(`${result.stdout}\n${result.stderr}`, pattern);
    }
  });
});

test("packed CLI recovers an orphaned transition-recovery claim and removes lock artifacts", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const cli = path.join(packageDir, "bin", "litopencode.cjs");
    const project = path.join(dir, "project");
    const create = run(process.execPath, [
      cli,
      "create-goals",
      "--project",
      project,
      "--session-id",
      "packed-orphan-recovery",
      "--objective",
      "recover the packed claim",
      "--criterion",
      "cleanup is complete"
    ]);
    assert.equal(create.status, 0, create.stderr);

    const loopDir = path.join(project, ".litopencode", "litgoal", "lit-loop");
    const transitionDir = path.join(loopDir, ".evidence-ledger-transition.lock");
    await fs.mkdir(transitionDir);
    await fs.writeFile(
      path.join(transitionDir, "recovery.json"),
      JSON.stringify({ token: "packed-orphaned-recovery", pid: 999_999_999 })
    );

    const checkpoint = run(process.execPath, [
      cli,
      "checkpoint",
      "--project",
      project,
      "--summary",
      "packed orphan recovered"
    ]);
    assert.equal(checkpoint.status, 0, checkpoint.stderr);
    await assert.rejects(fs.access(transitionDir), { code: "ENOENT" });
    assert.deepEqual(
      (await fs.readdir(loopDir)).filter((name) => /lock|candidate|released|abandoned|recovery/.test(name)),
      []
    );
  });
});

test("packed normative docs current workflow names resolve to packed command, feature, or skill catalogs", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    const catalogIds = new Set([
      ...packed.litOpenCodeCommands.map((command) => command.id),
      ...packed.litOpenCodeFeatures.map((feature) => feature.id),
      ...packed.litOpenCodeRuntimeSkills.map((skill) => skill.id)
    ]);

    const documents = [
      { label: "packed docs/migration.md", filePath: path.join(packageDir, "docs", "migration.md") },
      { label: "tracked docs/spec/litopencode-decisions.md", filePath: path.resolve("docs/spec/litopencode-decisions.md") }
    ];
    for (const document of documents) {
      const markdown = await fs.readFile(document.filePath, "utf8");
      const declarations = workflowNameDeclarations(markdown);
      const current = declarations.filter((declaration) => !declaration.historic);

      assert.equal(current.length, 1, `${document.label} should declare one current workflow list`);
      assert.ok(current[0].ids.length > 0, `${document.label} current workflow list should name installed surfaces`);

      const orphanIds = current[0].ids.filter((id) => !catalogIds.has(id));
      assert.deepEqual(orphanIds, [], `${document.label} declares orphan current workflows: ${orphanIds.join(", ")}`);

      for (const declaration of declarations.filter((candidate) => candidate.historic)) {
        assert.match(declaration.line, /not installed/i, `${document.label} historic workflows must be labeled not installed`);
      }
    }
  });
});

test("visualqa.current-native-package-boundary.characterization packed artifact ships native Visual QA without new authority", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    const visualQa = await fs.readFile(path.join(packageDir, "skills", "visual-qa", "SKILL.md"), "utf8");

    assert.equal(packed.litOpenCodeStaticOnlySkills.some((skill) => skill.id === "visual-qa"), false);
    assert.ok(packed.litOpenCodeRuntimeSkills.some((skill) => skill.id === "visual-qa"));
    assert.ok(packed.litOpenCodeFeatures.some((feature) => feature.id === "visual-qa"));
    assert.equal(packed.litOpenCodeCommands.some((command) => command.id === "visual-qa"), false);
    assert.match(visualQa, /native-installed/i);
    assert.match(visualQa, /not a browser executor/i);

    const probe = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const m = await import('./package/dist/index.js');",
        "const hooks = await m.default({ directory: process.cwd(), worktree: process.cwd() });",
        "const config = {};",
        "await hooks.config(config);",
        "if ('mcp' in config) throw new Error('visual-qa must not enroll MCP config');",
        "if (config.agent['visual-qa']) throw new Error('visual-qa must not enroll an agent');",
        "await hooks.dispose?.();",
        "console.log('visual-qa:packed:native:no-authority');"
      ].join(" ")
    ], { cwd: dir, env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: path.join(dir, "config") } });

    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /^visual-qa:packed:native:no-authority\s*$/);
  });
});

test("uiux.package-assets", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    const manifestPath = path.join(packageDir, "skills", "managed-skill-manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const requiredPaths = [
      "skills/readme-studio/SKILL.md",
      "skills/readme-studio/references/production.md",
      "skills/readme-studio/scripts/check-facts.mjs",
      "skills/readme-studio/templates/typography/outline.mjs",
      "skills/readme-studio/templates/remotion/package-lock.json",
      "skills/readme-studio/templates/hyperframes/index.motion.json",
      "skills/frontend-ui-ux/SKILL.md",
      "skills/frontend-ui-ux/references/production.md",
      "skills/frontend-ui-ux/schemas/design-contract-v1alpha1.json",
      "skills/frontend-ui-ux/schemas/design-contract-v1beta1.json",
      "skills/frontend-ui-ux/data/design-intelligence.json",
      "skills/frontend-ui-ux/data/PROVENANCE.json",
      "skills/frontend-ui-ux/data/LICENSE",
      "skills/frontend-ui-ux/data/THIRD-PARTY-NOTICE.txt",
      "skills/frontend-ui-ux/scripts/uiux.mjs",
      "skills/frontend-ui-ux/scripts/import-design-intelligence.mjs",
      "skills/visual-qa/schemas/evidence-manifest-v1alpha1.json",
      "skills/visual-qa/schemas/evidence-manifest-v1beta1.json",
      "skills/visual-qa/schemas/review-receipt-v1alpha1.json",
      "skills/visual-qa/scripts/visual-qa.mjs",
      "tools/run-uiux-visual-qa-scenarios.mjs"
    ];

    for (const relativePath of requiredPaths) {
      try {
        const stat = await fs.stat(path.join(packageDir, relativePath));
        assert.equal(stat.isFile(), true, `uiux.package-assets: expected packed file ${relativePath}`);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          assert.fail(`uiux.package-assets: missing packed capability file ${relativePath}`);
        }
        throw error;
      }
    }

    assert.ok(packed.litOpenCodeRuntimeSkills.some((skill) => skill.id === "frontend-ui-ux"));
    assert.ok(packed.litOpenCodeRuntimeSkills.some((skill) => skill.id === "visual-qa"));
    assert.ok(manifest.skills["frontend-ui-ux"], "managed manifest must enroll frontend-ui-ux nested assets");
    assert.ok(manifest.skills["visual-qa"], "managed manifest must enroll visual-qa nested assets");

    const dataPath = path.join(packageDir, "skills", "frontend-ui-ux", "data", "design-intelligence.json");
    const dataStat = await fs.stat(dataPath);
    const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
    const records = Array.isArray(data) ? data : data.records;
    assert.equal(records.length, 2_277);
    assert.ok(dataStat.size <= 4 * 1024 * 1024, "normalized design intelligence must be at most 4 MiB");

    const provenance = JSON.parse(
      await fs.readFile(path.join(packageDir, "skills", "frontend-ui-ux", "data", "PROVENANCE.json"), "utf8")
    );
    assert.equal(provenance.sources.length, 34);
    assert.equal(new Set(provenance.sources.map((source) => source.path)).size, 34);
    for (const source of provenance.sources) {
      assert.match(source.raw_sha256, /^[0-9a-f]{64}$/);
      assert.ok(Array.isArray(source.header) && source.header.length > 0);
      assert.ok(Array.isArray(source.selected_columns) && source.selected_columns.length > 0);
      assert.equal(Number.isFinite(source.data_row_count), true);
      assert.equal(Number.isFinite(source.normalized_record_count), true);
    }
    const notice = await fs.readFile(
      path.join(packageDir, "skills", "frontend-ui-ux", "data", "THIRD-PARTY-NOTICE.txt"),
      "utf8"
    );
    assert.match(notice, /34 allowlisted CSV source files/i);
    assert.match(notice, /PROVENANCE\.json/);

    const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies?.zod, "4.1.8");
    assert.equal(packageJson.dependencies?.["@opencode-ai/plugin"], undefined);
    assert.equal(packageJson.devDependencies?.["@opencode-ai/plugin"], "^1.17.6");
    assert.doesNotMatch(JSON.stringify(packageJson.dependencies ?? {}), /playwright|puppeteer|browser/i);
  });
});

test("packed visual-qa is self-contained, accepts material smoke PNGs, and blocks unproven full review", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const packedUiux = await import(
      pathToFileURL(path.join(packageDir, "skills", "frontend-ui-ux", "scripts", "uiux.mjs")).href
    );
    const uiuxBoundary = validBetaDesignContract();
    uiuxBoundary.tokens[0].value = "x".repeat(512);
    assert.equal(packedUiux.validateDesignContract(uiuxBoundary).valid, true);
    uiuxBoundary.tokens[0].value += "x";
    assert.equal(packedUiux.validateDesignContract(uiuxBoundary).valid, false);
    await fs.rm(path.join(packageDir, "skills", "frontend-ui-ux"), { recursive: true, force: true });
    const visualQa = await import(
      pathToFileURL(path.join(packageDir, "skills", "visual-qa", "scripts", "visual-qa.mjs")).href
    );
    const visualDesign = await import(
      pathToFileURL(path.join(packageDir, "skills", "visual-qa", "scripts", "design-contract.mjs")).href
    );
    const visualBoundary = validBetaDesignContract();
    visualBoundary.motion.reduced_motion_behavior = "x".repeat(512);
    assert.equal(visualDesign.validateDesignContract(visualBoundary).valid, true);
    visualBoundary.motion.reduced_motion_behavior += "x";
    assert.equal(visualDesign.validateDesignContract(visualBoundary).valid, false);
    const smoke = createBetaMaterialEvidence(visualQa, path.join(dir, "smoke-evidence"));
    assert.equal(visualQa.evaluateEvidenceManifest(smoke.manifest, smoke.bundle).verdict, "PASS");
    for (const capturePath of [
      path.join(smoke.bundle.evidenceRoot, "captures", "primary.png"),
      `../${path.basename(smoke.bundle.evidenceRoot)}/captures/primary.png`
    ]) {
      const invalid = structuredClone(smoke.manifest);
      invalid.captures[0].path = capturePath;
      assert.equal(visualQa.validateEvidenceManifest(invalid).valid, false);
      assert.equal(
        visualQa.evaluateEvidenceManifest(invalid, smoke.bundle).code,
        "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH"
      );
    }

    const full = createBetaMaterialEvidence(visualQa, path.join(dir, "full-evidence"), { tier: "full" });
    full.manifest.capabilities.independent_review = true;
    full.manifest.review_receipt_hashes = [`sha256:${"e".repeat(64)}`, `sha256:${"f".repeat(64)}`];
    const result = visualQa.evaluateEvidenceManifest(full.manifest, full.bundle);
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.code, "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
  });
});

test("packed artifact imports the plugin entry without installed dependencies", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "package", "package.json"), "utf8"));
    assert.equal(manifest.exports["./server"].import, "./dist/server.js");

    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      "import('./package/dist/index.js').then((m) => console.log(m.default?.id ?? m.pluginId))"
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^litopencode\s*$/);
  });
});

test("packed artifact exports benchmark claim guard API", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const m = await import('./package/dist/index.js');",
        "const verdict = m.classifyReferenceSuperiorityClaim('LitOpenCode는 모든 실제 개발 작업에서 REFERENCE보다 무조건 더 잘한다.', { benchmarkPassed: true });",
        "if (verdict.verdict !== 'blocked') throw new Error(JSON.stringify(verdict));",
        "if (!m.benchmarkGateAllowsStrongClaim({ tasksPerCategory: 3, winRate: 0.8, criticalRegressions: 0, referenceReplayCompleted: true, blindReviewCompleted: true, packedOpenCodeProbeCompleted: true })) throw new Error('gate should pass');",
        "console.log(m.litOpenCodeReferenceBenchmark.id + ':' + verdict.reason);"
      ].join(" ")
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^reference-superiority-benchmark:universal-superiority-claim\s*$/);
  });
});

test("packed artifact certifies declared benchmark universe claims", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const m = await import('./package/dist/index.js');",
        "const results = m.litOpenCodeReferenceBenchmark.taskCategories.flatMap((category) => Array.from({ length: m.litOpenCodeReferenceBenchmark.passThresholds.minimumTasksPerCategory }, (_, index) => ({ id: category + '-' + (index + 1), category, winner: 'litopencode', criticalRegressions: 0, artifacts: [...m.litOpenCodeReferenceBenchmark.requiredArtifacts], referenceReplayCompleted: true, blindReviewCompleted: true, packedOpenCodeProbeCompleted: true })));",
        "const certification = m.certifyDeclaredBenchmarkUniverse({ universeId: 'litopencode-real-dev-v1', declaredTaskIds: results.map((result) => result.id), taskResults: results });",
        "if (!certification.certified) throw new Error(JSON.stringify(certification));",
        "const claim = m.renderDeclaredBenchmarkUniverseClaim(certification);",
        "if (!claim.includes('선언된 benchmark universe의 모든 task')) throw new Error(claim);",
        "console.log(certification.taskCount + ':' + certification.blockers.length);"
      ].join(" ")
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^18:0\s*$/);
  });
});

test("packed artifact exports search workflow ideas", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const m = await import('./package/dist/index.js');",
        "const idea = m.findLitOpenCodeSearchWorkflowIdea('public-route-fallback');",
        "if (idea?.title !== 'Public Route Fallback') throw new Error(JSON.stringify(idea));",
        "if (!m.litOpenCodeSearchWorkflowIdeas.some((item) => item.id === 'ssrf-boundary')) throw new Error('missing ssrf boundary');",
        "console.log(m.litOpenCodeSearchWorkflowIdeas.length + ':' + idea.id);"
      ].join(" ")
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\d+:public-route-fallback\s*$/);
  });
});

test("packed artifact exports public source fetch runtime", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const m = await import('./package/dist/index.js');",
        "if (typeof m.fetchPublicSource !== 'function') throw new Error('missing fetchPublicSource');",
        "const denied = await m.fetchPublicSource('http://127.0.0.1/');",
        "if (denied.verdict !== 'blocked') throw new Error(JSON.stringify(denied));",
        "console.log('public-fetch:' + denied.verdict);"
      ].join(" ")
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^public-fetch:blocked\s*$/);
  });
});

test("packed artifact exports and drives the schema-3 bounded-authority lifecycle", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const project = path.join(dir, "authority-project");
    await fs.mkdir(path.join(project, "src"), { recursive: true });
    await fs.writeFile(path.join(project, "PLAN.md"), "# Packed approved plan\n");
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    const lifecycle = packed.createBoundedAuthorityLifecycle(project, { maxEvents: 4, maxHistory: 3 });
    const initialized = await lifecycle.init({
      schemaVersion: 3,
      requestId: "packed-init",
      sessionID: "packed-session",
      trustedUser: true,
      expectedRevision: 0,
      planPath: "PLAN.md",
      worktree: null,
      authorized: true,
      authority: [{ action: "write", root: "src" }]
    });
    assert.equal(packed.boundedAuthoritySchemaVersion, 3);
    assert.equal(initialized.state.status, "active");
    assert.equal(initialized.state.schemaVersion, 3);
    assert.equal(typeof packed.createBoundedAuthorityEventHook, "function");
    assert.equal(typeof packed.parseStartWorkLifecycleDirective, "function");
  });
});

test("fresh packed consumer install exposes host-safe tool schemas", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, archiveName);
    const consumer = path.join(dir, "consumer");
    const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", dir]);
    assert.equal(pack.status, 0, pack.stderr);
    await fs.mkdir(consumer);

    const init = run("npm", ["init", "-y"], { cwd: consumer });
    assert.equal(init.status, 0, init.stderr);
    await seedConsumerRuntimeDependencies(consumer);
    const installPackage = run("npm", ["install", "--omit=dev", "--ignore-scripts", archivePath], { cwd: consumer });
    assert.equal(installPackage.status, 0, installPackage.stderr);

    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "import plugin, * as lit from '@litfamily/litopencode';",
        "const fs = await import('node:fs/promises');",
        "await fs.mkdir('src', { recursive: true });",
        "await fs.mkdir('.litopencode', { recursive: true });",
        "await fs.writeFile('PLAN.md', '# Packed installed plan\\n');",
        "await fs.writeFile('.litopencode/config.json', JSON.stringify({ permissionMode: 'balanced' }));",
        "const hooks = await plugin({ directory: process.cwd(), worktree: process.cwd() });",
        "const text = JSON.stringify(hooks.tool);",
        "if (text.includes('\"type\":\"enum\"') || text.includes('\"defaultValue\"') || text.includes('\"values\"')) throw new Error(text);",
        "const config = {};",
        "await hooks.config(config);",
        "const readerMarker = '<litopencode-reader-facing-communication version=\\\"1\\\" enforcement=\\\"ADVISORY\\\">';",
        "if (!config.agent['lit-loop'].prompt.trimEnd().endsWith('</litopencode-reader-facing-communication>')) throw new Error('reader contract ordering check failed');",
        "if (config.agent['lit-loop'].prompt.split(readerMarker).length - 1 !== 1) throw new Error('reader contract agent default missing or duplicated');",
        "const systemOutput = { system: ['packed host system'] };",
        "await hooks['experimental.chat.system.transform']({ sessionID: 'packed-reader-system' }, systemOutput);",
        "if (systemOutput.system.join('\\n').split(readerMarker).length - 1 !== 1) throw new Error('reader contract system injection missing or duplicated');",
        "if (config.agent['lit-plan'].permission.edit !== 'deny') throw new Error('lit-plan edit permission missing');",
        "if (config.agent['lit-plan'].permission.bash !== 'deny') throw new Error('lit-plan bash permission missing');",
        "if (config.agent['lit-loop'].permission.task !== 'allow') throw new Error('primary task permission missing');",
        "if (config.agent['lit-explorer'].permission.task !== 'deny') throw new Error('subagent task permission must be denied');",
        "if (config.agent['lit-explorer'].tools.task !== false) throw new Error('subagent task tool must be disabled');",
        "if (config.agent.build.permission.task !== 'deny') throw new Error('builtin build task permission must be denied');",
        "if (config.agent['lit-forge-worker'].mode !== 'subagent') throw new Error('lit-forge-worker subagent missing');",
        "if ('hidden' in config.agent['lit-forge-worker']) throw new Error('lit-forge-worker should be discoverable');",
        "if (typeof hooks['experimental.text.complete'] !== 'function') throw new Error('text completion hook missing');",
        "if (typeof hooks.event !== 'function') throw new Error('bounded-authority event hook missing');",
        "const structuredStatus = { title: 'Packed structured status', output: '{\\\"schema_version\\\":3,\\\"status\\\":\\\"blocked\\\"}', metadata: { schema_version: 3, status: 'blocked' } };",
        "const structuredStatusBefore = JSON.stringify(structuredStatus);",
        "await hooks['tool.execute.after']({ tool: 'status', sessionID: 'packed-reader-system', callID: 'packed-reader-status', args: {} }, structuredStatus);",
        "if (JSON.stringify(structuredStatus) !== structuredStatusBefore) throw new Error('structured status output changed');",
        "const textOutput = { text: 'Thought: packed artifact probe\\n<!-- -->\\nVisible packed answer' };",
        "await hooks['experimental.text.complete']({ sessionID: 'packed-text-session', messageID: 'packed-text-message', partID: 'packed-text-part' }, textOutput);",
        "if (/^<!--\\s*-->$/m.test(textOutput.text)) throw new Error(textOutput.text);",
        "if (!textOutput.text.includes('Visible packed answer')) throw new Error(textOutput.text);",
        "const context = { sessionID: 'schema-hotfix-session', messageID: 'schema-hotfix-message', agent: 'lit-loop', directory: process.cwd(), worktree: process.cwd(), abort: new AbortController().signal, metadata() {}, async ask() {} };",
        "const executed = await hooks.tool.lit.execute({}, context);",
        "if (!String(executed.output).includes('Ledger initialized')) throw new Error(String(executed.output));",
        "const captured = await hooks.tool.wikify.execute({ action: 'capture', kind: 'decision', text: 'Use claims.jsonl as the packed consumer knowledge authority.', evidenceRef: 'PLAN.md:1', source: 'packed-consumer' }, context);",
        "if (captured.metadata.state !== 'review-needed') throw new Error('packed Wikify capture failed');",
        "const afterOutput = { title: 'Packed structured receipt', output: 'raw output remains inert', metadata: { litopencodeKnowledgeCapture: { kind: 'fact', text: 'Packed automatic receipts start in review-needed state.', evidenceRef: 'PLAN.md:2', source: 'packed-consumer' } } };",
        "await hooks['tool.execute.after']({ tool: 'evidence-recorder', sessionID: context.sessionID, callID: 'packed-after-call', args: {} }, afterOutput);",
        "const automaticReceipt = afterOutput.metadata?.litopencodeKnowledgeReceipt;",
        "if (automaticReceipt?.status !== 'captured' || !/^kn_[a-f0-9]{24}$/.test(automaticReceipt.id) || automaticReceipt.state !== 'review-needed') throw new Error('packed automatic receipt failed');",
        "const accepted = await hooks.tool.wikify.execute({ action: 'save', id: captured.metadata.id }, context);",
        "if (accepted.metadata.state !== 'accepted') throw new Error('packed Wikify save failed');",
        "const queried = await hooks.tool.wikify.execute({ action: 'query', query: 'consumer knowledge authority' }, context);",
        "if (!String(queried.output).includes('<litopencode-knowledge>')) throw new Error('packed Wikify query failed');",
        "const chatOutput = { message: { id: 'packed-chat-message', agent: 'lit-loop' }, parts: [{ id: 'packed-chat-part', type: 'text', text: 'Which packed knowledge file is authoritative?' }] };",
        "await hooks['chat.message']({ sessionID: context.sessionID, messageID: 'packed-chat-message', agent: 'lit-loop' }, chatOutput);",
        "if (!chatOutput.parts.some((part) => part.metadata?.litopencodeKnowledge !== undefined)) throw new Error('packed Wikify chat surface failed');",
        "const commandOutput = { parts: [] };",
        "await hooks['command.execute.before']({ command: '/wikify-query', arguments: 'consumer knowledge authority', sessionID: context.sessionID }, commandOutput);",
        "if (!commandOutput.parts.some((part) => part.metadata?.litopencodeKnowledge !== undefined)) throw new Error('packed Wikify command surface failed');",
        "await fs.writeFile('.litopencode/knowledge/claims.jsonl', 'not-json\\n');",
        "for (const action of ['query', 'status']) { const blocked = await hooks.tool.wikify.execute(action === 'query' ? { action, query: 'authority' } : { action }, context); if (blocked.metadata?.blocked !== true || blocked.metadata.reason !== 'STORE_ERROR' || !String(blocked.output).startsWith('BLOCKED:')) throw new Error('packed malformed-store block failed: ' + action); }",
        "const lifecycle = lit.createBoundedAuthorityLifecycle(process.cwd());",
        "const initialized = await lifecycle.init({ schemaVersion: 3, requestId: 'installed-init', sessionID: context.sessionID, trustedUser: true, expectedRevision: 0, planPath: 'PLAN.md', worktree: null, authorized: true, authority: [{ action: 'write', root: 'src' }] });",
        "if (initialized.state.schemaVersion !== 3 || initialized.state.status !== 'active') throw new Error('schema-3 lifecycle init failed');",
        "const lifecycleStatus = await hooks.tool['start-work'].execute({ action: 'status' }, context);",
        "if (!String(lifecycleStatus.output).includes('schema 3 bounded-authority: active')) throw new Error(String(lifecycleStatus.output));",
        "await hooks.dispose?.();",
        "console.log('host-safe:' + Object.keys(hooks.tool).sort().join(',') + ':plan-deny:depth-one:subagent-discoverable:reader-contract:structured-preserved:text-complete-clean:schema3-event:wikify-five-surfaces');"
      ].join(" ")
    ], { cwd: consumer });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^host-safe:lit,litwork,review-work,start-work,wikify:plan-deny:depth-one:subagent-discoverable:reader-contract:structured-preserved:text-complete-clean:schema3-event:wikify-five-surfaces\s*$/);
  });
});

test("packed artifact chat activation emits opencode-compatible part ids", async () => {
  await withTempDir(async (dir) => {
    await packAndExtract(dir);
    const result = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "const { createChatMessageActivationHook } = await import('./package/dist/index.js');",
        "const root = process.cwd();",
        "const hook = createChatMessageActivationHook(root);",
        "const output = { message: { id: 'msg_pack_probe' }, parts: [{ id: 'prt_user', sessionID: 'ses_pack_probe', messageID: 'msg_pack_probe', type: 'text', text: 'Hi lit' }] };",
        "await hook({ sessionID: 'ses_pack_probe', messageID: 'msg_pack_probe', agent: 'lit-loop' }, output);",
        "const part = output.parts.at(-1);",
        "const inert = { message: { id: 'msg_quote_probe' }, parts: [{ id: 'prt_quote_user', sessionID: 'ses_quote_probe', messageID: 'msg_quote_probe', type: 'text', text: 'A quoted example says \\\"lit research papers\\\".' }] };",
        "await hook({ sessionID: 'ses_quote_probe', messageID: 'msg_quote_probe', agent: 'lit-loop' }, inert);",
        "if (inert.parts.length !== 1) throw new Error('embedded quoted research mention activated');",
        "const research = { message: { id: 'msg_research_probe' }, parts: [{ id: 'prt_research_user', sessionID: 'ses_research_probe', messageID: 'msg_research_probe', type: 'text', text: 'lit research papers' }] };",
        "await hook({ sessionID: 'ses_research_probe', messageID: 'msg_research_probe', agent: 'lit-loop' }, research);",
        "if (research.parts.length !== 2 || research.parts.at(-1).metadata?.litopencode?.mode !== 'lit-research') throw new Error('valid natural research invocation did not activate');",
        "console.log(part.id + ':' + String(part.synthetic) + ':quoted-inert:natural-research-active');"
      ].join(" ")
    ], { cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prt_litopencode_lit_task_msg_pack_probe:undefined:quoted-inert:natural-research-active\s*$/);
  });
});

test("packed artifact shipped package scripts are intentional and self-consistent", async () => {
  await withTempDir(async (dir) => {
    const packageDir = await packAndExtract(dir);
    const commands = [
      ["npm", ["run", "scan:legacy-tokens"]],
      ["npm", ["run", "check:version"]],
      ["npm", ["run", "check:pack-payload"]],
      ["npm", ["run", "typecheck"]]
    ];

    for (const [command, args] of commands) {
      const result = run(command, args, { cwd: packageDir });
      const message = command + " " + args.join(" ") + "\nSTDOUT:\n" + result.stdout + "\nSTDERR:\n" + result.stderr;
      assert.equal(result.status, 0, message);
    }
  });
});

test("installed packed binary writes opencode plugin config", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, archiveName);
    const root = path.join(dir, "opencode-root");
    const consumer = path.join(dir, "consumer");
    const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", dir]);
    assert.equal(pack.status, 0, pack.stderr);
    await fs.mkdir(consumer);

    const init = run("npm", ["init", "-y"], { cwd: consumer });
    assert.equal(init.status, 0, init.stderr);
    await seedConsumerRuntimeDependencies(consumer);
    const installPackage = run("npm", ["install", archivePath], { cwd: consumer });
    assert.equal(installPackage.status, 0, installPackage.stderr);
    assert.doesNotMatch(installPackage.stderr, /package: '@litfamily\/litopencode'.*EBADENGINE/s);

    const emptyConfigHome = path.join(dir, "empty-config");
    await fs.mkdir(emptyConfigHome);
    const serverImport = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "process.env.XDG_CONFIG_HOME = " + JSON.stringify(emptyConfigHome) + ";",
        "const m = await import('@litfamily/litopencode/server');",
        "const hooks = await m.default({});",
        "const config = {};",
        "await hooks.config(config);",
        "console.log(typeof m.default + ':' + config.default_agent + ':' + config.agent['lit-loop'].mode + ':' + (config.agent['lit-loop'].model ?? 'none'));"
      ].join(" ")
    ], { cwd: consumer });
    assert.equal(serverImport.status, 0, serverImport.stderr);
    assert.match(serverImport.stdout, /^function:lit-loop:all:openai\/gpt-6-astra\s*$/);

    const result = run(
      path.join(consumer, "node_modules", ".bin", "litopencode"),
      ["install", "--root", root, "--model-prompt"],
      {
        cwd: consumer,
        input: "\n\n"
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LitOpenCode/);
    assert.match(result.stdout, /OpenCode plugin setup/);
    assert.match(result.stdout, /Complete/);

    const output = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"));
    assert.deepEqual(output.plugin, [packageId]);
    const litConfig = JSON.parse(await fs.readFile(path.join(root, "litopencode.json"), "utf8"));
    assert.equal(litConfig.agents["lit-loop"].category, "execution");
    assert.equal(litConfig.categories.execution.variant, "max");
    assert.equal(litConfig.categories.execution.provider, "openai");
    assert.equal(litConfig.categories.execution.model, "gpt-6-luna");
    assert.equal(litConfig.categories.research.variant, "max");
    assert.equal(litConfig.categories.research.provider, "openai");
    assert.equal(litConfig.categories.research.model, "gpt-6-luna");

    const configuredConfigHome = path.join(dir, "configured-config");
    await fs.mkdir(path.join(configuredConfigHome, "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(configuredConfigHome, "opencode", "litopencode.json"),
      JSON.stringify(litConfig),
      "utf8"
    );
    const configuredServerImport = run(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "process.env.XDG_CONFIG_HOME = " + JSON.stringify(configuredConfigHome) + ";",
        "const m = await import('@litfamily/litopencode/server');",
        "const hooks = await m.default({ directory: process.cwd(), worktree: process.cwd() });",
        "const config = {};",
        "await hooks.config(config);",
        "console.log(JSON.stringify({ origin: import.meta.resolve('@litfamily/litopencode/server'), agents: Object.fromEntries(['lit-plan', 'lit-loop', 'lit-oracle', 'lit-librarian'].map((id) => [id, { model: config.agent[id].model, variant: config.agent[id].variant, edit: config.agent[id].permission?.edit, bash: config.agent[id].permission?.bash }])) }));"
      ].join(" ")
    ], { cwd: consumer });
    assert.equal(configuredServerImport.status, 0, configuredServerImport.stderr);
    const loaded = JSON.parse(configuredServerImport.stdout);
    assert.match(loaded.origin, new RegExp(consumer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/node_modules/@litfamily/litopencode/dist/server\\.js$"));
    assert.doesNotMatch(loaded.origin, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const agentId of ["lit-plan", "lit-oracle"]) {
      assert.equal(loaded.agents[agentId].model, "openai/gpt-6-astra");
      assert.equal(loaded.agents[agentId].variant, "xhigh");
    }
    assert.equal(loaded.agents["lit-loop"].model, "openai/gpt-6-astra");
    assert.equal(loaded.agents["lit-loop"].variant, "xhigh");
    assert.equal(loaded.agents["lit-librarian"].model, "openai/gpt-6-luna");
    assert.equal(loaded.agents["lit-librarian"].variant, "max");
    assert.equal(loaded.agents["lit-plan"].edit, "deny");
    assert.equal(loaded.agents["lit-plan"].bash, "deny");
  });
});
