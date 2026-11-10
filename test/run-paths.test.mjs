import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { classifyRunPath } from "../src/run-paths.ts";

async function withRoots(fn) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-run-paths-")));
  try {
    const home = path.join(base, "home");
    const project = path.join(base, "project");
    const config = path.join(home, ".config", "opencode");
    const data = path.join(home, ".local", "share", "opencode");
    const realSkills = path.join(base, "dotfiles", "skills");
    for (const dir of [project, path.join(home, ".ssh"), data, realSkills, path.join(realSkills, "x")]) await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(config, { recursive: true });
    await fs.symlink(realSkills, path.join(config, "skills"));
    await fs.writeFile(path.join(realSkills, "x", "SKILL.md"), "# x\n");
    const ctx = { projectRoot: project, baseDirectory: project, home, configDirs: [config], dataDir: data };
    await fn({ base, home, project, config, data, ctx });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

test("secret and host-settings files are protected; look-alike names stay ordinary; harness skills read through a symlink", async () => {
  await withRoots(async ({ home, project, config, data, ctx }) => {
    const protectedCases = [
      [".env", "read"], [".env.local", "read"], [".envrc", "read"], [path.join(home, ".ssh", "config"), "read"],
      ["id_ed25519", "read"], ["server.pem", "read"], [path.join(data, "auth.json"), "read"], [path.join(config, "opencode.json"), "read"],
      ["opencode.jsonc", "write"], [".litopencode/litgoal/lit-loop/work-schema-3.json", "write"], [".litopencode/litgoal/lit-loop/cancel-notices.json", "write"],
      [path.join(home, ".zshrc"), "write"], [path.join(config, "plugin", "x.js"), "write"], [path.join(home, ".npmrc"), "read"]
    ];
    if (process.platform === "darwin") protectedCases.push([path.join(home, ".SSH", "config"), "read"]);
    for (const [target, access] of protectedCases) assert.equal(classifyRunPath(target, ctx, access), "protected", `${target} ${access}`);
    const ordinary = [
      [".env.example", "read"], ["id_ed25519.pub", "read"], ["id_map.json", "read"], ["deck.key", "read"],
      [path.join(data, "opencode.db"), "read"], [path.join(data, "tool-output", "tool_abc"), "read"],
      ["opencode.jsonc", "read"], [".litopencode/litgoal/lit-loop/work-schema-3.json", "read"], [path.join(home, ".zshrc"), "read"],
      ["src/index.ts", "write"]
    ];
    for (const [target, access] of ordinary) assert.equal(classifyRunPath(target, ctx, access), "ordinary", `${target} ${access}`);
    assert.equal(classifyRunPath(path.join(config, "skills", "x", "SKILL.md"), ctx, "read"), "harness-read");
    assert.equal(classifyRunPath(path.join(config, "AGENTS.md"), ctx, "read"), "harness-read");
    assert.equal(classifyRunPath(path.join(config, "skills", "x", "SKILL.md"), ctx, "write"), "ordinary");
    void project;
  });
});

test("a relative path resolves against the launch directory, and a linked worktree protects the shared git config", async () => {
  await withRoots(async ({ base, project, ctx }) => {
    await fs.mkdir(path.join(project, "sub"), { recursive: true });
    const nested = { ...ctx, baseDirectory: path.join(project, "sub") };
    assert.equal(classifyRunPath("../.litopencode/litgoal/lit-loop/work-schema-3.json", nested, "write"), "protected");
    assert.equal(classifyRunPath(".litopencode/litgoal/lit-loop/work-schema-3.json", nested, "write"), "ordinary", "that one is under sub/, not the project's");
    const git = (...args) => execFileSync("git", args, { cwd: project, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
    git("init", "-q");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
    const linked = path.join(base, "linked");
    git("worktree", "add", "-q", linked);
    const linkedCtx = { ...ctx, projectRoot: linked, baseDirectory: linked };
    assert.equal(classifyRunPath(path.join(project, ".git", "config"), linkedCtx, "write"), "protected");
    assert.equal(classifyRunPath(path.join(project, ".git", "hooks", "pre-push"), linkedCtx, "write"), "protected");
    assert.equal(classifyRunPath(path.join(project, ".git", "config"), linkedCtx, "read"), "ordinary");
  });
});
