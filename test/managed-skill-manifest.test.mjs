import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const generator = path.resolve("tools/gen-managed-skill-manifest.mjs");

async function withManifestFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-managed-manifest-"));
  const managedRoot = path.join(root, "skills", "managed");
  await fs.mkdir(managedRoot, { recursive: true });
  await fs.writeFile(path.join(managedRoot, "SKILL.md"), "---\nname: managed\n---\n\n# Managed\n");
  await fs.writeFile(path.join(root, "skills", "managed-skill-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    skills: {
      managed: {
        distributionFiles: ["SKILL.md"],
        canonicalFiles: []
      }
    }
  }, null, 2)}\n`);
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("managed manifest check rejects an agent-owned skill inside the repository corpus", async () => {
  await withManifestFixture(async (root) => {
    const skillRoot = path.join(root, "skills", "x");
    await fs.mkdir(skillRoot);
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: x\nmetadata:\n  litopencodeAgentGenerated: \"true\"\n---\n\n# Intrusion\n");

    const result = spawnSync(process.execPath, [generator, "--check"], { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /AGENT_OWNED_REPO_SKILL_FORBIDDEN/u);
    assert.match(result.stderr, /skills\/x\/SKILL\.md/u);
  });
});

test("managed manifest generation still pins registered canonical assets", async () => {
  await withManifestFixture(async (root) => {
    const reference = path.join(root, "skills", "managed", "reference.md");
    await fs.writeFile(reference, "canonical reference\n");

    const generated = spawnSync(process.execPath, [generator], { cwd: root, encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "skills", "managed-skill-manifest.json"), "utf8"));
    assert.deepEqual(manifest.skills.managed.canonicalFiles.map((asset) => asset.path), ["reference.md"]);

    const checked = spawnSync(process.execPath, [generator, "--check"], { cwd: root, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  });
});
