import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { revalidateStableRegularFile } from "../skills/frontend-ui-ux/scripts/stable-file-read.mjs";
import { verifyCanonicalFrontendCorpus } from "../skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";

const referencesRoot = path.resolve("skills/frontend-ui-ux/references");
const verifierPath = path.resolve("skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs");
const manifestPath = path.join(referencesRoot, "_canonical-corpus", "manifest.json");
const expectedDigest = "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7";

function runVerifier(root, extraArgs = []) {
  return spawnSync(process.execPath, [verifierPath, "--root", root, "--json", ...extraArgs], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

async function withCorpusCopy(fn) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-canonical-corpus-"));
  const root = path.join(temp, "references");
  try {
    await fs.cp(referencesRoot, root, { recursive: true, preserveTimestamps: true });
    await fn(root);
  } finally {
    await fs.chmod(root, 0o755).catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
}

test("canonical frontend library is the exact pinned 167-file byte corpus", async () => {
  const result = runVerifier(referencesRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    {
      ok: report.ok,
      commit: report.commit,
      tree: report.tree,
      count: report.count,
      bytes: report.bytes,
      digest: report.digest
    },
    {
      ok: true,
      commit: "8ec16c5129df7b9778959e8367657d0e79c2c3bb",
      tree: "9188410be0af35f2421ba300d91a0d7a7341caf0",
      count: 167,
      bytes: 2_596_349,
      digest: expectedDigest
    }
  );
  assert.equal(report.protectedPaths.length, 171, "167 corpus files plus manifest and three legal files");

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.files.length, 167);
  assert.equal(manifest.files.reduce((sum, entry) => sum + entry.size, 0), 2_596_349);
  assert.deepEqual(manifest.roots, ["design", "designpowers", "perfection", "ui-ux-db"]);
  for (const entry of manifest.files) {
    assert.deepEqual(Object.keys(entry), ["path", "size", "sha256"]);
    assert.match(entry.path, /^(?:design|designpowers|perfection|ui-ux-db)\//u);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
});

test("canonical capture records retain immutable file and ancestor snapshots", async () => {
  const report = await verifyCanonicalFrontendCorpus(referencesRoot);
  assert.equal(report.capturedFiles.size, 171);
  for (const record of report.capturedFiles.values()) {
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.snapshot), true);
    assert.equal(Object.isFrozen(record.snapshot.file), true);
    assert.equal(Object.isFrozen(record.snapshot.ancestors), true);
    assert.equal(record.snapshot.ancestors.every(Object.isFrozen), true);
    assert.equal(await revalidateStableRegularFile(record.snapshot), true);
  }
});

test("documented Node verifier invocation resolves its source-relative default root", async () => {
  const skill = await fs.readFile("skills/frontend-ui-ux/SKILL.md", "utf8");
  assert.match(skill, /`node scripts\/verify-canonical-corpus\.mjs --json`/u);
  assert.doesNotMatch(skill, /`(?:\.\/)?scripts\/verify-canonical-corpus\.mjs(?:\s|`)/u);
  const unrelatedCwd = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-verifier-cwd-"));
  try {
    const result = spawnSync(process.execPath, [verifierPath, "--json"], { cwd: unrelatedCwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).digest, expectedDigest);
  } finally {
    await fs.rm(unrelatedCwd, { recursive: true, force: true });
  }
});

test("canonical verifier CLI rejects malformed grammar and accepts an explicit root with spaces", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-verifier-cli-"));
  const spacedRoot = path.join(temp, "explicit references root with spaces");
  try {
    await fs.cp(referencesRoot, spacedRoot, { recursive: true, preserveTimestamps: true });
    const valid = spawnSync(process.execPath, [verifierPath, "--json", "--root", spacedRoot], {
      cwd: temp,
      encoding: "utf8"
    });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).digest, expectedDigest);

    const invalid = [
      ["missing root value", ["--root"], /--root requires one path value/iu],
      ["option in root value position", ["--root", "--json"], /--root requires one path value/iu],
      ["unknown option", ["--wat"], /unknown option.*--wat/iu],
      ["duplicate root", ["--root", spacedRoot, "--root", spacedRoot], /duplicate option.*--root/iu],
      ["duplicate json", ["--json", "--json"], /duplicate option.*--json/iu],
      ["positional argument", ["references"], /unexpected positional argument.*references/iu],
      ["explicit root plus positional argument", ["--root", spacedRoot, "extra"], /unexpected positional argument.*extra/iu]
    ];
    for (const [label, args, pattern] of invalid) {
      const result = spawnSync(process.execPath, [verifierPath, ...args], { cwd: temp, encoding: "utf8" });
      assert.equal(result.status, 1, `${label}: ${result.stderr || result.stdout}`);
      assert.match(`${result.stdout}\n${result.stderr}`, pattern, label);
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("canonical corpus verifier runs when invoked through a symlinked installed path", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-canonical-verifier-link-"));
  const linkedVerifier = path.join(temp, "verify-canonical-corpus.mjs");
  try {
    await fs.symlink(verifierPath, linkedVerifier);
    const result = spawnSync(process.execPath, [linkedVerifier, "--root", referencesRoot, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.digest, expectedDigest);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("canonical verifier rejects symlink and special structural boundaries before traversal", async () => {
  await withCorpusCopy(async (root) => {
    const parent = path.dirname(root);
    const rootLink = path.join(parent, "references-link");
    await fs.symlink(root, rootLink);
    let result = runVerifier(rootLink);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).error, /references root.*symbolic link/iu);

    const rootFile = path.join(parent, "references-file");
    await fs.writeFile(rootFile, "not a directory");
    result = runVerifier(rootFile);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).error, /references root.*special/iu);

    for (const name of ["_canonical-corpus", "design", "designpowers", "perfection", "ui-ux-db"]) {
      const boundary = path.join(root, name);
      const held = path.join(root, `${name}.held`);
      await fs.rename(boundary, held);
      try {
        await fs.symlink(path.basename(held), boundary);
        result = runVerifier(root);
        assert.equal(result.status, 1, `${name} symlink: ${result.stderr || result.stdout}`);
        assert.match(JSON.parse(result.stdout).error, new RegExp(`${name}.*symbolic link`, "iu"));
        await fs.rm(boundary);
        await fs.writeFile(boundary, "not a directory");
        result = runVerifier(root);
        assert.equal(result.status, 1, `${name} special: ${result.stderr || result.stdout}`);
        assert.match(JSON.parse(result.stdout).error, new RegExp(`${name}.*special`, "iu"));
      } finally {
        await fs.rm(boundary, { force: true });
        await fs.rename(held, boundary);
      }
    }
  });
});

test("canonical corpus legal files and CRLF policy are pinned", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.legal, [
    { path: "_canonical-corpus/LICENSE", sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1" },
    { path: "_canonical-corpus/ATTRIBUTION.md", sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92" },
    { path: "_canonical-corpus/LICENSE-Apache-2.0.txt", sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da" }
  ]);
  const attributes = await fs.readFile(".gitattributes", "utf8");
  assert.match(attributes, /skills\/frontend-ui-ux\/references\/(?:design|\{design,designpowers,perfection,ui-ux-db\})\/\*\*\*?\s+-text/u);

  const protectedExamples = [
    "skills/frontend-ui-ux/references/design/apple.md",
    "skills/frontend-ui-ux/references/designpowers/EVIDENCE.md",
    "skills/frontend-ui-ux/references/perfection/README.md",
    "skills/frontend-ui-ux/references/ui-ux-db/data/colors.csv",
    "skills/frontend-ui-ux/references/_canonical-corpus/LICENSE",
    "skills/frontend-ui-ux/references/_canonical-corpus/ATTRIBUTION.md",
    "skills/frontend-ui-ux/references/_canonical-corpus/LICENSE-Apache-2.0.txt"
  ];
  const check = spawnSync("git", ["check-attr", "text", "--", ...protectedExamples], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(check.status, 0, check.stderr);
  for (const relativePath of protectedExamples) {
    assert.match(check.stdout, new RegExp(`${relativePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}: text: unset`, "u"));
  }
});

test("canonical corpus verifier fails closed for changed, missing, extra, symlink, and special files", async (t) => {
  const cases = [
    ["changed", async (root) => fs.appendFile(path.join(root, "design", "apple.md"), "tamper")],
    ["missing", async (root) => fs.rm(path.join(root, "design", "apple.md"))],
    ["extra", async (root) => fs.writeFile(path.join(root, "design", "extra.md"), "extra")],
    ["symlink", async (root) => {
      const target = path.join(root, "design", "apple.md");
      await fs.rm(target);
      await fs.symlink("airbnb.md", target);
    }],
    ["special", async (root) => {
      const target = path.join(root, "design", "apple.md");
      await fs.rm(target);
      const made = spawnSync("mkfifo", [target], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
    }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      await withCorpusCopy(async (root) => {
        await mutate(root);
        const result = runVerifier(root);
        assert.equal(result.status, 1, `${name}: ${result.stderr || result.stdout}`);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.match(report.error, /changed|missing|extra|symbolic link|special file|file set|SHA-256/i);
      });
    });
  }
});

test("canonical verifier rejects deterministic final-file substitution after descriptor read", async () => {
  await withCorpusCopy(async (root) => {
    const target = path.join(root, "design", "apple.md");
    const held = `${target}.held`;
    let substituted = false;
    try {
      await assert.rejects(
        verifyCanonicalFrontendCorpus(root, {
          async afterFileRead(relativePath) {
            if (relativePath !== "design/apple.md" || substituted) return;
            substituted = true;
            await fs.rename(target, held);
            await fs.writeFile(target, "substituted after the verified descriptor read\n");
          }
        }),
        /identity changed|ancestor changed|SHA-256|size changed/iu
      );
      assert.equal(substituted, true, "the deterministic substitution checkpoint must run");
    } finally {
      if (substituted) {
        await fs.rm(target, { force: true });
        await fs.rename(held, target);
      }
    }
  });
});

test("canonical verifier rejects deterministic ancestor substitution after descriptor read", async () => {
  await withCorpusCopy(async (root) => {
    const targetDirectory = path.join(root, "design");
    const held = `${targetDirectory}.held`;
    let substituted = false;
    try {
      await assert.rejects(
        verifyCanonicalFrontendCorpus(root, {
          async afterFileRead(relativePath) {
            if (relativePath !== "design/apple.md" || substituted) return;
            substituted = true;
            await fs.rename(targetDirectory, held);
            await fs.mkdir(targetDirectory);
            await fs.copyFile(path.join(held, "apple.md"), path.join(targetDirectory, "apple.md"));
          }
        }),
        /ancestor changed|identity changed/iu
      );
      assert.equal(substituted, true, "the deterministic ancestor checkpoint must run");
    } finally {
      if (substituted) {
        await fs.rm(targetDirectory, { recursive: true, force: true });
        await fs.rename(held, targetDirectory);
      }
    }
  });
});

test("canonical corpus verifier fails closed for unreadable and legal mismatch", async (t) => {
  await t.test("unreadable", async () => {
    await withCorpusCopy(async (root) => {
      const target = path.join(root, "design", "apple.md");
      await fs.chmod(target, 0o000);
      try {
        const result = runVerifier(root);
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(JSON.parse(result.stdout).error, /read|permission|EACCES/i);
      } finally {
        await fs.chmod(target, 0o644);
      }
    });
  });

  await t.test("legal mismatch", async () => {
    await withCorpusCopy(async (root) => {
      await fs.appendFile(path.join(root, "_canonical-corpus", "ATTRIBUTION.md"), "tamper");
      const result = runVerifier(root);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(JSON.parse(result.stdout).error, /legal|ATTRIBUTION|SHA-256/i);
    });
  });
});

test("canonical manifest rejects carrier fields and metadata tamper", async () => {
  await withCorpusCopy(async (root) => {
    const localManifest = path.join(root, "_canonical-corpus", "manifest.json");
    const manifest = JSON.parse(await fs.readFile(localManifest, "utf8"));
    manifest.allowlistedTerms = ["carrier"];
    await fs.writeFile(localManifest, JSON.stringify(manifest));
    const result = runVerifier(root);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(JSON.parse(result.stdout).error, /field|schema|manifest/i);
  });
});
