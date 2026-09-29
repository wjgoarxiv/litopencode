import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const checkerPath = path.resolve("tools/check-pack-payload.mjs");
const packageVersion = JSON.parse(fsSync.readFileSync("package.json", "utf8")).version;
const managedSkillManifest = JSON.parse(fsSync.readFileSync("skills/managed-skill-manifest.json", "utf8"));
const packageId = `@litfamily/litopencode@${packageVersion}`;
const packageArchiveName = `litfamily-litopencode-${packageVersion}.tgz`;
const requiredHandoffPaths = [
  "skills/lit-handoff/SKILL.md",
  "vendor/licenses/022_handoff-MIT.txt",
  "vendor/provenance/022_handoff.md",
  "vendor/handoff/SKILL.md",
  "vendor/handoff/evals/evals.json",
  "vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
  "vendor/handoff/templates/HANDOFF.md"
];
const requiredScientificVisualizationPaths = [
  "skills/lit-scientific-visualization/SKILL.md",
  "vendor/NOTICE.md",
  "vendor/licenses/045_scientific-visualization-MIT.txt",
  "vendor/provenance/045_scientific-visualization.md",
  "vendor/scientific-visualization/SKILL.md",
  "vendor/scientific-visualization/assets/color_palettes.py",
  "vendor/scientific-visualization/assets/nature.mplstyle",
  "vendor/scientific-visualization/assets/presentation.mplstyle",
  "vendor/scientific-visualization/assets/publication.mplstyle",
  "vendor/scientific-visualization/evals/evals.json",
  "vendor/scientific-visualization/references/color_palettes.md",
  "vendor/scientific-visualization/references/journal_requirements.md",
  "vendor/scientific-visualization/references/matplotlib_examples.md",
  "vendor/scientific-visualization/references/mdanalysis_martini_visualization.md",
  "vendor/scientific-visualization/references/publication_guidelines.md",
  "vendor/scientific-visualization/references/seaborn_for_publications.md",
  "vendor/scientific-visualization/scripts/figure_export.py",
  "vendor/scientific-visualization/scripts/style_presets.py",
  "vendor/scientific-visualization/tests/test_figure_export.py",
  "vendor/scientific-visualization/tests/test_style_presets.py"
];
const requiredVendorPaths = [
  "vendor/NOTICE.md",
  "vendor/licenses/022_handoff-MIT.txt",
  "vendor/licenses/045_scientific-visualization-MIT.txt",
  "vendor/provenance/022_handoff.md",
  "vendor/provenance/045_scientific-visualization.md"
];
function canonicalPackagePath(id, definition, relativePath) {
  return definition.canonicalRoot === undefined
    ? `skills/${id}/${relativePath}`
    : path.posix.normalize(path.posix.join("skills", id, definition.canonicalRoot, relativePath));
}
const requiredReadmePaths = [
  "README.md",
  "README-Ko-KR.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/lit-mark.md",
  "docs/migration.md",
  "docs/privacy.md",
  "docs/reference-Ko-KR.md",
  "docs/reference.md",
  "docs/assets/cover.webp",
  "docs/assets/cover-motion.webp",
  "docs/assets/cover-motion-still.webp",
  "docs/assets/readme/ascii-readme.svg",
  "docs/assets/readme/badge-license.svg",
  "docs/assets/readme/badge-version.svg",
  "docs/assets/readme/JetBrainsMono-OFL.txt",
  "docs/assets/readme/Lucide-LICENSE.txt",
  "docs/assets/readme/ignition-film.mp4",
  "docs/assets/readme/ignition-readme.gif",
  "docs/assets/readme/litfamily-machines.png",
  "docs/assets/readme/litopencode-clay-icon.png",
  "docs/assets/readme/litopencode-wordmark.svg",
  "docs/assets/readme/lucide-book-open.svg",
  "docs/assets/readme/lucide-play.svg",
  "docs/assets/readme/lucide-shield-check.svg",
  "docs/assets/readme/poster.png"
];
const readmeCdn = `https://cdn.jsdelivr.net/npm/${packageId}/`;
// The npm pages pin package-CDN images; the GitHub pages load the same shipped files by relative path.
// The Jev snapshots and the promo film are shown by the GitHub pages only and stay out of the package.
const githubOnlyReadmeMedia = /^docs\/assets\/readme\/(?:jev-[^/]+\.webp|promo(?:-[^/]+)?\.[^/]+|promo-source(?:\/.*)?)$/u;
const readmeImagePaths = [...new Set(["README.md", "README-Ko-KR.md", "README-npm.md", "README-npm-Ko-KR.md"].flatMap((file) =>
  [...fsSync.readFileSync(file, "utf8").matchAll(/(?:!\[[^\]]*\]\(|\b(?:src|srcset)=")([^)"\s]+)/gu)]
    .map((match) => match[1])
    .filter((target) => target.startsWith(readmeCdn) || target.startsWith("./"))
    .map((target) => target.startsWith("./") ? target.slice(2) : target.slice(readmeCdn.length))
    .filter((imagePath) => !githubOnlyReadmeMedia.test(imagePath))
))];
const requiredPackagePaths = [
  ...new Set([...requiredReadmePaths, ...readmeImagePaths]),
  "skills/skill-rename-aliases.json",
  "skills/managed-skill-manifest.json",
  ...requiredVendorPaths,
  ...Object.entries(managedSkillManifest.skills).flatMap(([id, definition]) => [
    ...definition.distributionFiles.map((relativePath) => `skills/${id}/${relativePath}`),
    ...definition.canonicalFiles.map((asset) => canonicalPackagePath(id, definition, asset.path))
  ])
];

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-pack-payload-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeManifest(dir, manifest) {
  const manifestPath = path.join(dir, "pack-report.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function packageReport(paths) {
  return [
    {
      id: packageId,
      name: "@litfamily/litopencode",
      version: packageVersion,
      filename: packageArchiveName,
      files: paths.map((filePath) => ({ path: filePath, size: 1, mode: 420 }))
    }
  ];
}

function guardedPath(...parts) {
  return parts.join("");
}

function runChecker(args, input) {
  return spawnSync(process.execPath, [checkerPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input
  });
}

test("README assets and linked files ship while unrelated presentation files stay excluded", () => {
  const required = ["package.json", "dist/index.js", ...requiredPackagePaths];
  for (const unwanted of ["cover.png", "docs/assets/cover.svg", "docs/release-checklist.md", "generate_cover.py", "docs/assets/readme/unapproved-source.psd", "docs/assets/readme/jev-doctor.webp", "docs/assets/readme/jev-toast-first-hint.webp", "docs/assets/readme/jev-toast-hint.webp", "docs/assets/readme/jev-toast-notice.webp", "docs/assets/readme/promo-preview.webp", "docs/assets/readme/promo-still.webp", "docs/assets/readme/promo.mp4", "docs/assets/readme/promo-source/index.html", "docs/assets/readme/promo-source/treatment.json", "README-npm.md", "README-npm-Ko-KR.md", ".readme-npm-backup/README.md", "tools/readme-for-npm.mjs"]) {
    const result = runChecker(["--stdin"], JSON.stringify(packageReport([...required, unwanted])));
    assert.equal(result.status, 1, `${unwanted} must stay out of npm: ${result.stdout}`);
    assert.ok(result.stdout.includes(unwanted));
  }
  const control = runChecker(["--stdin"], JSON.stringify(packageReport([
    ...required, "docs/assets/icon-512.png"
  ])));
  assert.equal(control.status, 0, control.stdout + control.stderr);
});

test("the GitHub-only README media never counts as a required package file", () => {
  for (const file of ["README-npm.md", "README-npm-Ko-KR.md"]) {
    const card = fsSync.readFileSync(file, "utf8");
    assert.doesNotMatch(card, /docs\/assets\/readme\/(?:jev-|promo)/u, `${file} references no GitHub-only media`);
  }
  assert.equal(requiredPackagePaths.some((filePath) => githubOnlyReadmeMedia.test(filePath)), false);
  const result = runChecker(["--stdin"], JSON.stringify(packageReport([
    "package.json", "dist/index.js", ...requiredPackagePaths, "docs/assets/readme/jev-doctor.webp"
  ])));
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stdout.includes("GitHub-only README media"), result.stdout);
});

test("every README skill snapshot and A/B image must ship in the package", () => {
  for (const image of ["docs/assets/skills/lit-pptx.webp", "docs/ab/S11/lit-desktop.webp"]) {
    assert.ok(readmeImagePaths.includes(image), `${image} should be a README image`);
    const result = runChecker(["--stdin"], JSON.stringify(packageReport([
      "package.json",
      "dist/index.js",
      ...requiredPackagePaths.filter((filePath) => filePath !== image)
    ])));
    assert.equal(result.status, 1, `${image} missing from the pack must fail: ${result.stdout}`);
    assert.ok(result.stdout.includes(image));
  }
});

test("clean pack manifest passes from file", async () => {
  await withTempDir(async (dir) => {
    const manifestPath = await writeManifest(dir, packageReport([
      "package.json",
      "dist/index.js",
      "dist/index.d.ts",
      "bin/litopencode",
      "skills/workflow-loop/SKILL.md",
      ...requiredPackagePaths
    ]));

    const result = runChecker(["--file", manifestPath]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`pack payload guard passed: ${requiredPackagePaths.length + 5} files checked`));
  });
});

test("visualqa.current-pack-guard.characterization accepts the complete managed native payload", () => {
  const result = runChecker(["--stdin"], JSON.stringify(packageReport([
    "package.json",
    "dist/index.js",
    ...requiredPackagePaths
  ])));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`pack payload guard passed: ${requiredPackagePaths.length + 2} files checked`));
});

test("clean pack manifest passes from stdin", async () => {
  const result = runChecker(["--stdin"], JSON.stringify(packageReport([
    "package.json",
    "dist/config.js",
    ...requiredPackagePaths
  ])));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`pack payload guard passed: ${requiredPackagePaths.length + 2} files checked`));
});

test("CI keeps the dry-pack report outside the package root and guards that exact report", async () => {
  const workflow = await fs.readFile(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /npm pack --dry-run --json > "\$RUNNER_TEMP\/pack-report\.json"/u);
  assert.match(workflow, /node tools\/check-pack-payload\.mjs --file "\$RUNNER_TEMP\/pack-report\.json"/u);
  assert.doesNotMatch(workflow, />\s*pack-report\.json\b/u);
  assert.match(workflow, /No release-command placeholder guard[\s\S]*?\.github package\.json src test/u);
});

test("manifest missing one canonical scientific asset fails closed", () => {
  const missingPath = "vendor/scientific-visualization/scripts/style_presets.py";
  const incomplete = requiredPackagePaths.filter((filePath) => filePath !== missingPath);
  const result = runChecker(["--stdin"], JSON.stringify(packageReport(["package.json", "dist/index.js", ...incomplete])));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 1 required path missing/);
  assert.match(result.stdout, /vendor\/scientific-visualization\/scripts\/style_presets\.py/);
});

test("only the two canonical scientific Python tests bypass the global test-path guard", () => {
  const seeded = [
    ...requiredPackagePaths,
    "vendor/scientific-visualization/tests/unapproved_test.py",
    "skills/another-skill/tests/test_fixture.py"
  ];
  const result = runChecker(["--stdin"], JSON.stringify(packageReport(seeded)));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 2 forbidden paths/);
  assert.doesNotMatch(result.stdout, /vendor\/scientific-visualization\/tests\/test_(?:figure_export|style_presets)\.py/);
});

test("manifest missing one canonical handoff asset fails closed", () => {
  const incomplete = requiredPackagePaths.filter((filePath) => !filePath.endsWith("templates/HANDOFF.md"));
  const result = runChecker(["--stdin"], JSON.stringify(packageReport(["package.json", "dist/index.js", ...incomplete])));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 1 required path missing/);
  assert.match(result.stdout, /vendor\/handoff\/templates\/HANDOFF\.md/);
});

test("unexpected managed-skill payload files fail closed", () => {
  const seeded = [
    ...requiredPackagePaths,
    "vendor/handoff/unexpected.pyc",
    "vendor/scientific-visualization/local-notes.jsonl"
  ];
  const result = runChecker(["--stdin"], JSON.stringify(packageReport(seeded)));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 2 forbidden paths/);
  assert.match(result.stdout, /unexpected\.pyc/);
  assert.match(result.stdout, /local-notes\.jsonl/);
});

test("diagram previews, foils, evidence, and source archives stay out of the package", () => {
  for (const unwanted of [
    "skills/lit-diagram-drawer/ab/score.json",
    "skills/lit-diagram-drawer/evidence/run.json",
    "skills/lit-diagram-drawer/examples/01-service-architecture/constructed-naive-foil.html",
    "skills/lit-diagram-drawer/assets/previews/architecture.png",
    "skills/lit-diagram-drawer/plans/brief.md",
    "skills/lit-diagram-drawer/_refs/archive.md",
    "skills/lit-diagram-drawer/scripts/office-proof.py"
  ]) {
    const result = runChecker(["--stdin"], JSON.stringify(packageReport([...requiredPackagePaths, unwanted])));
    assert.equal(result.status, 1, `${unwanted} must stay out of npm: ${result.stdout}`);
    assert.ok(result.stdout.includes(unwanted));
  }
});

test("project-local Wikify knowledge cannot enter the package payload", () => {
  const result = runChecker(["--stdin"], JSON.stringify(packageReport([
    "package.json",
    "dist/index.js",
    ...requiredPackagePaths,
    ".litopencode/knowledge/claims.jsonl"
  ])));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 1 forbidden path/u);
  assert.match(result.stdout, /\.litopencode\/knowledge\/claims\.jsonl/u);
});

test("nested hidden product state below an included skill stays outside the package", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "pack-boundary-fixture", version: "1.0.0" }));
    await fs.copyFile(".npmignore", path.join(dir, ".npmignore"));
    await fs.mkdir(path.join(dir, "skills", "wikify"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "wikify", "SKILL.md"), "included skill\n");

    const stateNames = [".litopencode", ".litcodex", ".litclaude", ".hermes", `.${"o"}mo`];
    const created = stateNames.map((name) => path.join("skills", "wikify", name, "ledger.jsonl"));
    for (const relativePath of created) {
      await fs.mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true });
      await fs.writeFile(path.join(dir, relativePath), "nested local state\n");
    }

    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);
    for (const relativePath of created) {
      assert.equal(files.includes(relativePath), false, `nested local state was packed: ${relativePath}`);
    }
  });
});

test("pack payload guard rejects nested state from other harnesses", () => {
  const otherHarnessState = [
    "docs/.litclaude/ledger.jsonl",
    "docs/.hermes/state.json",
    `docs/.${"o"}mo/state.json`
  ];
  const result = runChecker(["--stdin"], JSON.stringify(packageReport([
    "package.json",
    "dist/index.js",
    ...requiredPackagePaths,
    ...otherHarnessState
  ])));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /pack payload guard failed: 3 forbidden paths/u);
  for (const relativePath of otherHarnessState) assert.match(result.stdout, new RegExp(relativePath.replaceAll("/", "\\/"), "u"));
});

test("seeded forbidden pack manifest fails closed", async () => {
  await withTempDir(async (dir) => {
    const referencePath = guardedPath("# REFERENCE/lazy", "codex-main/README.md");
    const manifestPath = await writeManifest(dir, packageReport([
      "package.json",
      "INITIAL_PROMPT.md",
      "HANDOFF.md",
      ".github/workflows/ci.yml",
      "generate_cover.py",
      "docs/recon/litopencode-recon.md",
      "docs/spec/litopencode-decisions.md",
      "plans/litopencode-rebrand-sdd.md",
      ".litcodex/lit-loop/ledger.jsonl",
      ".litopencode/litgoal/state.json",
      "evidence/start-work.txt",
      "test/unit.test.mjs",
      "test/fixtures/local-only.json",
      "tests/fixtures/local-only.json",
      referencePath,
      packageArchiveName,
      "node_modules/typescript/package.json",
      ".git/config",
      "tools/legacy-token-allowlist.json"
    ]));

    const result = runChecker(["--file", manifestPath]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /pack payload guard failed: 18 forbidden paths/);
    assert.match(result.stdout, /INITIAL_PROMPT\.md/);
    assert.match(result.stdout, /docs\/spec\/litopencode-decisions\.md/);
    assert.match(result.stdout, /generate_cover\.py/);
    assert.match(result.stdout, /plans\/litopencode-rebrand-sdd\.md/);
    assert.match(result.stdout, /test\/unit\.test\.mjs/);
    assert.match(result.stdout, /\.litcodex\/lit-loop\/ledger\.jsonl/);
    assert.match(result.stdout, /# REFERENCE\//);
    assert.match(result.stdout, /tools\/legacy-token-allowlist\.json/);
  });
});

test("malformed pack manifest fails closed", async () => {
  await withTempDir(async (dir) => {
    const manifestPath = path.join(dir, "pack-report.json");
    await fs.writeFile(manifestPath, "{");

    const result = runChecker(["--file", manifestPath]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /pack payload guard error/);
    assert.match(result.stderr, /cannot read or parse manifest/);
  });
});

test("manifest without files array fails closed", async () => {
  await withTempDir(async (dir) => {
    const manifestPath = await writeManifest(dir, [{ name: "@litfamily/litopencode" }]);

    const result = runChecker(["--file", manifestPath]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /manifest package files must be an array/);
  });
});

test("pack guard requires the one-release skill alias registry", () => {
  const incomplete = requiredPackagePaths.filter((filePath) => filePath !== "skills/skill-rename-aliases.json");
  const result = runChecker(["--stdin"], JSON.stringify(packageReport(["package.json", "dist/index.js", ...incomplete])));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /skills\/skill-rename-aliases\.json/u);
});
