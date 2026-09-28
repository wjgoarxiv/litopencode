import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { externalCompanionPaths } from "../tools/check-payload-substance.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECKER = join(REPO_ROOT, "tools", "check-payload-substance.mjs");
const FAMILY_ROOT = process.env.LITOPENCODE_FAMILY_ROOT;
const FAMILY_LAYOUT = process.env.LITOPENCODE_FAMILY_LAYOUT;
const FAMILY_AVAILABLE = Boolean(FAMILY_ROOT && FAMILY_LAYOUT);

function runChecker(args = []) {
  const env = { ...process.env };
  delete env.LITOPENCODE_FAMILY_ROOT;
  delete env.LITOPENCODE_FAMILY_LAYOUT;
  return spawnSync(process.execPath, [CHECKER, ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
}

function assertFreshFamilyResult(result) {
	const diagnostics = `${result.stdout}\n${result.stderr}`;
	assert.equal(result.status, 0, diagnostics);
	assert.match(result.stdout, /^PAYLOAD_PARITY_FRESHNESS_PASS: family-manifest$/mu);
	assert.doesNotMatch(diagnostics, /^PAYLOAD_PARITY_MANIFEST_FRESHNESS_/mu);
}

const PARITY_MANIFEST = join(REPO_ROOT, "tools", "payload-substance-parity.json");

const PRODUCT_PARITY_ARGS = [
  "--product-root",
  REPO_ROOT,
  "--product-id",
  "p32",
  "--parity-manifest",
  PARITY_MANIFEST,
];

test("scientific visualization closure counts its vendor notice, not another skill notice", () => {
  const packed = new Set([
    "vendor/licenses/045_scientific-visualization-MIT.txt",
    "vendor/provenance/045_scientific-visualization.md",
    "vendor/NOTICE.md",
    "skills/lit-humanizer/NOTICE"
  ]);
  const roots = [join(REPO_ROOT, "vendor", "scientific-visualization")];
  assert.deepEqual(
    [...externalCompanionPaths(REPO_ROOT, { name: "lit-scientific-visualization" }, packed, roots)].sort(),
    [
      "vendor/NOTICE.md",
      "vendor/licenses/045_scientific-visualization-MIT.txt",
      "vendor/provenance/045_scientific-visualization.md"
    ]
  );
});

test("payload substance gate accepts the current packed skill tree", () => {
  const result = runChecker(PRODUCT_PARITY_ARGS);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_SUBSTANCE_PASS/);
});

test("packed SKILL.md references resolve against the npm payload", () => {
  const result = runChecker(PRODUCT_PARITY_ARGS);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_REFERENCES_PASS: claims=\d+ exemptions=\d+/);
});

test("cross-product payload parity always checks the committed family manifest", () => {
	const result = runChecker(PRODUCT_PARITY_ARGS);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /PAYLOAD_PARITY_PASS: source=manifest fraction=0\.5/);
	assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=autoconference median=30 closures=.*p32:24/);
	assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=review-work median=1 closures=.*p32:1/);
});

test("optional family freshness probe stays not configured without an injected layout", () => {
	const result = runChecker();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.doesNotMatch(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
});

test("optional family freshness probe resolves the OpenCode skill closures", { skip: !FAMILY_AVAILABLE }, () => {
	const result = runChecker(["--family-root", FAMILY_ROOT, "--family-layout", FAMILY_LAYOUT]);
	assertFreshFamilyResult(result);
});

test("family freshness rejects a malformed injected layout", () => {
	const root = mkdtempSync(join(tmpdir(), "litopencode-family-layout-"));
	try {
		const result = runChecker(["--family-root", root, "--family-layout", "{not-json}"]);
		assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
		assert.match(result.stderr, /PAYLOAD_FAMILY_LAYOUT_INVALID: expected JSON text or a JSON file/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("optional family freshness probe blocks stale manifests and misleading nonzero output", { skip: !FAMILY_AVAILABLE }, () => {
	const root = mkdtempSync(join(tmpdir(), "litopencode-family-freshness-"));
	try {
		const manifest = JSON.parse(readFileSync(PARITY_MANIFEST, "utf8"));
		manifest.skills.autoconference.closures.p32 += 1;
		const staleManifest = join(root, "payload-substance-parity.json");
		writeFileSync(staleManifest, `${JSON.stringify(manifest, null, 2)}\n`);

		const stale = runChecker(["--family-root", FAMILY_ROOT, "--family-layout", FAMILY_LAYOUT, "--parity-manifest", staleManifest]);
		assert.equal(stale.status, 1, `${stale.stdout}\n${stale.stderr}`);
		assert.match(stale.stderr, /PAYLOAD_PARITY_MANIFEST_FRESHNESS_CLOSURE_STALE skill=autoconference product=p32 expected=25 actual=24/);
		assert.doesNotMatch(stale.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
		assert.throws(() => assertFreshFamilyResult(stale), /PAYLOAD_PARITY_MANIFEST_FRESHNESS_CLOSURE_STALE/);

		const unexpected = runChecker(["--family-root", FAMILY_ROOT, "--family-layout", FAMILY_LAYOUT, "--unexpected-diagnostic"]);
		assert.equal(unexpected.status, 2, `${unexpected.stdout}\n${unexpected.stderr}`);
		assert.match(unexpected.stderr, /PAYLOAD_SUBSTANCE_ERROR: UNKNOWN_OPTION: --unexpected-diagnostic/);
		assert.throws(
			() => assertFreshFamilyResult({ ...unexpected, stdout: "PAYLOAD_PARITY_FRESHNESS_PASS: family-manifest\n" }),
			/PAYLOAD_SUBSTANCE_ERROR: UNKNOWN_OPTION: --unexpected-diagnostic/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("payload substance gate names an unallowlisted hollow skill", () => {
  const root = mkdtempSync(join(tmpdir(), "litopencode-substance-hollow-"));
  try {
    const skills = join(root, "skills");
    mkdirSync(join(skills, "solid"), { recursive: true });
    mkdirSync(join(skills, "hollow"), { recursive: true });
    writeFileSync(join(skills, "solid", "SKILL.md"), "solid\n");
    writeFileSync(join(skills, "hollow", "SKILL.md"), "hollow\n");
    const allowlist = join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { solid: "This bounded instruction is complete for its procedural review." } }));
    const pack = join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "skills/solid/SKILL.md" }, { path: "skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_SUBSTANCE_FAIL/);
    assert.match(`${result.stdout}\n${result.stderr}`, /hollow/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("payload reference gate names the missing token", () => {
  const root = mkdtempSync(join(tmpdir(), "litopencode-reference-missing-"));
  try {
    const skills = join(root, "skills");
    mkdirSync(join(skills, "hollow"), { recursive: true });
    writeFileSync(join(skills, "hollow", "SKILL.md"), "This skill claims `references/not-packed.md`.\n");
    const allowlist = join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { hollow: "This bounded fixture contains the complete instruction body for its procedural review." } }));
    const pack = join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_REFERENCE_FAIL skill=hollow token=references\/not-packed\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
