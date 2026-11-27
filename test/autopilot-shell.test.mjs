// The start-work shell guard, scenario by scenario (plans/2026-11-27-autopilot-port/scenarios.md, A2 and the
// security table). Every case runs the guard's own word parser; no shell is asked to read the commands.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { classifyShellCommand, isAllowlistedCheck } from "../src/autopilot-shell.ts";

function project(grants = ["read", "write"]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-shell-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-shell-outside-")));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/feat/qa\n");
  fs.writeFileSync(path.join(root, "src", "a.mjs"), "export {};\n");
  fs.writeFileSync(path.join(root, "ok.mjs"), "process.exit(0);\n");
  fs.writeFileSync(path.join(root, "check.mjs"), "process.exit(0);\n");
  fs.symlinkSync(path.join(outside, "target"), path.join(root, "notes.txt"));
  fs.symlinkSync(path.join(outside, "touched"), path.join(root, "dangling.txt"));
  fs.symlinkSync(path.join(outside, "nowhere"), path.join(root, "dlink"));
  fs.symlinkSync(path.join(root, ".git"), path.join(root, "gitlink"));
  fs.symlinkSync(outside, path.join(root, "outlink"));
  const ctx = (extra = {}) => ({
    cwd: root,
    projectRoot: root,
    grants: grants.map((action) => ({ action, root })),
    doneCheck: "node check.mjs",
    ...extra
  });
  return { root, outside, ctx, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); } };
}

function kindOf(verdict) {
  if (verdict.kind !== "park") return verdict.kind;
  return verdict.hold === undefined ? `park-${verdict.tier}` : "held";
}

test("S-A2-04: tier B is the allowlist of local undoable verbs inside the project", () => {
  const p = project();
  try {
    for (const command of ["touch fresh.txt", "mkdir -p out/dir", "cp src/a.mjs src/copy.mjs", "mv src/a.mjs src/renamed.mjs", "cd src && touch b.txt"]) {
      assert.equal(kindOf(classifyShellCommand(command, p.ctx())), "park-B", command);
    }
  } finally {
    p.cleanup();
  }
});

test("readers inside the grants, the Done-when check and a granted node script run now", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["cat src/a.mjs", "ls", "grep -n export src/a.mjs", "git status", "git log --oneline", "cat src/a.mjs | wc -l", "node check.mjs", "node ok.mjs", "cd src && cat a.mjs", "head -n 2 src/a.mjs 2>/dev/null", "pwd", "echo ok", "printf '%s\\n' done && git status"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    for (const writes of ["echo ok > x.txt", "printf a >> src/a.mjs", "pwd > where.txt"]) {
      assert.notEqual(classifyShellCommand(writes, p.ctx()).kind, "allow", writes);
    }
    assert.equal(isAllowlistedCheck("node plans/x/done-check.mjs"), true);
    for (const shaped of ["node a.mjs; echo ok", "npm test", "node a.mjs | tee x", "node -e 1", "node $HOME/x.mjs"]) assert.equal(isAllowlistedCheck(shaped), false, shaped);
  } finally {
    p.cleanup();
  }
});

test("S-A2-08 / S-A2-09: a self-check refused only for its shape gets a split hint; a mutating part does not", () => {
  const p = project(["read", "write", "execute"]);
  try {
    const hint = classifyShellCommand("node check.mjs; echo \"exit=$?\"", p.ctx());
    assert.equal(hint.kind, "split");
    assert.deepEqual(hint.parts, ["node check.mjs"]);
    assert.equal(classifyShellCommand("node ok.mjs 2>&1; echo $?", p.ctx()).kind, "split");
    assert.equal(classifyShellCommand("cat src/a.mjs || true", p.ctx()).kind, "split");
    const push = classifyShellCommand("node ok.mjs || git push", p.ctx());
    assert.equal(kindOf(push), "park-X");
    assert.equal(push.outward, true);
    assert.equal(kindOf(classifyShellCommand("node ok.mjs; rm -rf ../zz", p.ctx())), "park-X");
    assert.equal(classifyShellCommand(`cd ${os.homedir()} && cat .aws/credentials`, p.ctx()).kind, "refuse");
  } finally {
    p.cleanup();
  }
});

test("S-SEC-01..09: dangling links, .git in any case, links out and overwrites are never tier B", () => {
  const p = project();
  try {
    assert.equal(kindOf(classifyShellCommand("cp src/a.mjs notes.txt", p.ctx())), "park-X", "S-SEC-01 dangling cp target");
    assert.equal(kindOf(classifyShellCommand("touch dangling.txt", p.ctx())), "park-X", "S-SEC-02");
    assert.equal(kindOf(classifyShellCommand("mkdir -p dlink/x", p.ctx())), "park-X", "S-SEC-03");
    assert.equal(classifyShellCommand("touch .GIT/hooks/pre-commit", p.ctx()).kind, "refuse", "S-SEC-04 upper");
    assert.equal(classifyShellCommand("cp src/a.mjs .Git/hooks/pre-commit", p.ctx()).kind, "refuse", "S-SEC-04 mixed");
    for (const command of ["cp src/a.mjs gitlink/hooks/pre-commit", "mkdir -p gitlink/x", "cd src && mv a.mjs ../.git/HEAD", "cp -r src .git", "touch .git/x"]) {
      assert.notEqual(kindOf(classifyShellCommand(command, p.ctx())), "park-B", command);
    }
    assert.equal(kindOf(classifyShellCommand("touch outlink/probe.txt", p.ctx())), "park-X", "S-SEC-07");
    assert.equal(kindOf(classifyShellCommand(`touch ${p.outside}/f2.txt`, p.ctx())), "park-X", "S-SEC-08 abs");
    assert.equal(kindOf(classifyShellCommand("cp src/a.mjs ../x", p.ctx())), "park-X", "S-SEC-08 rel");
    assert.equal(kindOf(classifyShellCommand("mv src/a.mjs ok.mjs", p.ctx())), "park-X", "S-SEC-09 mv");
    assert.equal(kindOf(classifyShellCommand("cp src/a.mjs ok.mjs", p.ctx())), "park-X", "S-SEC-09 cp");
    assert.equal(fs.existsSync(path.join(p.outside, "target")), false);
  } finally {
    p.cleanup();
  }
});

test("S-SEC-10..17: prefixes, assignments, expansions and unread shapes are held, never replayable", () => {
  const p = project();
  try {
    const held = [
      "time pushd .. && touch s4b-time.txt", "A=1 cd .. && touch s4b-assign.txt", "! touch x", "nice cd .. && touch x",
      "nohup touch x", "timeout 5 touch x", "stdbuf -o0 touch x", "ionice touch x", "chroot / touch x", "doas touch x",
      "pushd .. && touch x", "popd", "builtin cd .. && touch x", "command touch x", "exec touch x", "eval 'touch x'",
      "source x.sh", ". x.sh", "env X=1 touch x", "sudo touch x", "xargs touch", "alias", "set", "shopt", "trap", "enable",
      "touch glob*.txt", "touch {a,b}.txt", "touch x > other.txt", "touch a\\ b", "touch ~/x",
      "echo dG91Y2g= | base64 -d | sh", "xxd -r x", "openssl enc -d -in x", "sh -c 'x'", "bash -lc x", "cat $HOME/x", "touch `cmd`",
      "echo \"unclosed", "touch a &&  && touch b", "cd -"
    ];
    for (const command of held) assert.equal(kindOf(classifyShellCommand(command, p.ctx())), "held", command);
    assert.equal(classifyShellCommand("cd", p.ctx()).kind, "refuse", "bare cd");
    assert.equal(kindOf(classifyShellCommand("cd .. && touch x", p.ctx())), "park-X", "cd out of the project");
  } finally {
    p.cleanup();
  }
});

test("S-SEC-18..24: script runners, package scripts, outward and irreversible commands are X; most keep a run open", () => {
  const p = project(["read", "write"]);
  try {
    for (const command of ["node ok.mjs --write x", "python3 x.py", "bash run.sh", "sh run.sh", "./run.sh", "perl x.pl", "deno run x.ts"]) {
      assert.equal(kindOf(classifyShellCommand(command, p.ctx())), "park-X", command);
    }
    const outward = ["npm run clean", "npm run build", "npm test", "npm start", "npx x", "pnpm run build", "yarn build", "bun run x", "make all", "make ship",
      "gh pr merge 12", "npm unpublish x", "npm deprecate x old", "curl -X POST https://example.invalid/a", "wget https://example.invalid", "ssh host ls",
      "scp a host:b", "docker push x", "aws s3 rm s3://b/k", "rm -rf build", "git push origin b", "git tag v1", "npm publish", "git reset --hard",
      "git clean -fd build", "git config x y", "npm version patch", "git pu", "git frobnicate", "pnpm exec x", "yarn dlx x", "bun x y", "npm run-script x",
      "rm -rf ../dist-old", "find ../dist-old -delete", "unlink /x"];
    for (const command of outward) {
      const verdict = classifyShellCommand(command, p.ctx());
      assert.equal(verdict.kind, "park", command);
      assert.equal(verdict.tier, "X", command);
      assert.equal(verdict.outward, true, command);
    }
    assert.equal(classifyShellCommand("node ok.mjs > out.txt", p.ctx()).outward, false, "a local script with a redirect is set aside at completion");
  } finally {
    p.cleanup();
  }
});

test("S-SEC-25..28: secrets, settings and real host homes are refused, also through quotes and cd", () => {
  const p = project();
  const home = os.homedir();
  try {
    const refused = [
      `cd ${home} && cat .aws/credentials`,
      `cat ${home}/.cl""aude/settings.json`,
      `cat ${home}/.c'l'aude/settings.json`,
      `cd ${home}/Desktop && cd .. && cat .ssh/config`,
      "cd ~someone && ls",
      `cat ${home}/.ssh/id_ed25519`, `cat ${home}/.npmrc`, "cat .env", "cat .envrc", "cat server.pem", `cat ${home}/.zshrc`,
      `ls ${home}/.config/opencode`, `cat ${home}/.local/share/opencode/auth.json`, "cat opencode.json", "cat .mcp.json",
      "cat .litopencode/litgoal/lit-loop/autopilot.json"
    ];
    for (const command of refused) assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    for (const command of ["cat .env.example", "cat .env.sample", "cat .env.template"]) assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
  } finally {
    p.cleanup();
  }
});

test("S-A4-01 / S-A4-05: a charter allows named-file commits on its branch only", () => {
  const p = project();
  try {
    const charter = { branch: "feat/qa", repo: "." };
    const withCharter = p.ctx({ charter });
    assert.equal(classifyShellCommand("git add src/a.mjs && git commit -m \"feat: a\"", withCharter).kind, "allow");
    assert.equal(classifyShellCommand("git commit -a -q -m 'x'", withCharter).kind, "allow");
    for (const command of ["git commit --amend -m x", "git commit -n -m x", "git commit --no-verify -m x", "git -c user.name=x commit -m x", "git -C .. commit -m x",
      "git add -A", "git add .", "git commit -m \"$(whoami)\"", "git commit -m x && git push", "GIT_DIR=x git commit -m x"]) {
      assert.notEqual(classifyShellCommand(command, withCharter).kind, "allow", command);
    }
    assert.notEqual(classifyShellCommand("git commit -m x", p.ctx({ charter: { branch: "main", repo: "." } })).kind, "allow", "other branch");
    assert.notEqual(classifyShellCommand("git commit -m x", p.ctx()).kind, "allow", "no charter");
    assert.equal(kindOf(classifyShellCommand("git add src/a.mjs", p.ctx())), "park-B", "git add without a charter is tier B");
  } finally {
    p.cleanup();
  }
});

test("S-A4-01: a linked-worktree .git file is followed to read the branch", () => {
  const p = project();
  const linked = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-linked-")));
  try {
    const gitDir = path.join(p.root, ".git", "worktrees", "linked");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/feat/linked\n");
    fs.writeFileSync(path.join(linked, ".git"), `gitdir: ${gitDir}\n`);
    fs.writeFileSync(path.join(linked, "a.txt"), "a\n");
    const ctx = { cwd: linked, projectRoot: linked, grants: [{ action: "read", root: linked }], charter: { branch: "feat/linked", repo: "." } };
    assert.equal(classifyShellCommand("git commit -m x", ctx).kind, "allow");
    assert.notEqual(classifyShellCommand("git commit -m x", { ...ctx, charter: { branch: "feat/qa", repo: "." } }).kind, "allow");
  } finally {
    fs.rmSync(linked, { recursive: true, force: true });
    p.cleanup();
  }
});

// Review clarifications C-1..C-6 (scenarios.md section 6).

test("C-1: the repo's own test and check commands run; unknown verbs and other runners park as X", () => {
  const p = project(["read", "write", "execute"]);
  try {
    fs.writeFileSync(path.join(p.root, "package.json"), "{}\n");
    fs.mkdirSync(path.join(p.root, "test"));
    fs.writeFileSync(path.join(p.root, "test", "a.test.mjs"), "\n");
    for (const command of ["npm test", "npm t", "npm run check", "npm run lint", "npm run build", "npm run typecheck", "npm run test:unit", "npm test -- --grep fast", "node --test test/a.test.mjs", "node --test"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    for (const command of ["npm run clean", "npm run release", "npm --prefix .. test", "npm test -- ../x", "node --test ../x.test.mjs", "npx vitest", "npm run build -- --out=../dist"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    for (const command of ["dd if=src/a.mjs of=b", "tar -C src -xf x.tar", "ln -s src x", "chmod +x ok.mjs", "truncate -s 0 src/a.mjs", "install ok.mjs bin/", "patch -p1", "go run .", "cargo run", "uv run x.py", "frobnicate"]) {
      assert.equal(kindOf(classifyShellCommand(command, p.ctx())), "park-X", command);
    }
  } finally {
    p.cleanup();
  }
});

test("C-1: without package.json in the folder, or without an execute grant, npm test parks", () => {
  const p = project(["read", "write"]);
  try {
    fs.writeFileSync(path.join(p.root, "package.json"), "{}\n");
    assert.equal(kindOf(classifyShellCommand("npm test", p.ctx())), "park-X", "no execute grant");
  } finally {
    p.cleanup();
  }
  const q = project(["read", "write", "execute"]);
  try {
    assert.equal(kindOf(classifyShellCommand("npm test", q.ctx())), "park-X", "no package.json");
  } finally {
    q.cleanup();
  }
});

test("C-3: reader forms that write or execute are not readers", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["sed -n 1,5p src/a.mjs", "sed 's/a/b/g' src/a.mjs", "sed -n '/export/p' src/a.mjs", "sed -e 's/a/b/' -e 3q src/a.mjs", "uniq src/a.mjs", "sort src/a.mjs", "git branch --show-current", "git branch -a", "git remote -v", "git rev-parse --show-toplevel", "git diff --stat"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    const writes = [
      "sed 'w out.txt' src/a.mjs", "sed 's/a/b/w out.txt' src/a.mjs", "sed 'W out.txt' src/a.mjs", "sed 'e date' src/a.mjs", "sed 's/a/date/e' src/a.mjs",
      "sed 'r /etc/hosts' src/a.mjs", "sed 'R x' src/a.mjs", "sed -f script.sed src/a.mjs", "sed -i 's/a/b/' src/a.mjs", "sed --in-place=.bak 's/a/b/' src/a.mjs",
      "sed -e 'w x' src/a.mjs", "awk '{print}' src/a.mjs", "awk 'BEGIN{system(\"date\")}'", "sort -o out.txt src/a.mjs", "sort -oout.txt src/a.mjs",
      "sort --output=out.txt src/a.mjs", "uniq src/a.mjs out.txt", "tree -o out.txt", "git diff --output=out.txt", "git log --output=x", "git show --output x",
      "find . -fprint0 out", "find . -fprint out", "find . -fls out", "find . -exec rm {} +", "find . -ok rm {} +", "find . -delete", "rg --pre ./x.sh a",
      "git grep -O a", "git branch -D main", "git branch -d x", "git branch -f x", "git branch -m x y", "git branch -c x y", "git branch newbranch",
      "git remote add x ../y", "file -C -m magic", "grep --file=../outside/pattern src/a.mjs"
    ];
    for (const command of writes) assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
  } finally {
    p.cleanup();
  }
});

test("C-3: pagers with a + command, jq reading the environment or file names, and rg --hostname-bin are held", () => {
  const p = project(["read", "write", "execute"]);
  try {
    assert.equal(classifyShellCommand("jq .name src/a.mjs", p.ctx()).kind, "allow");
    for (const command of [
      "less '+!date' src/a.mjs", "less +F src/a.mjs", "more '+/x' src/a.mjs", "less src/a.mjs",
      "jq -n env", "jq -n '$ENV.HOME'", "jq '$ENV' src/a.mjs", "jq 'env.PATH' src/a.mjs", "jq input_filename src/a.mjs",
      "jq -n '$__prog_args'", "jq --rawfile x ../outside src/a.mjs", "jq --slurpfile x ../outside src/a.mjs",
      "rg --hostname-bin ./x.sh a", "rg --hostname-bin=./x.sh a"
    ]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
  } finally {
    p.cleanup();
  }
});

test("C-3: a split hint never drops a mutating part", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["cat src/a.mjs; echo x > ../f", "echo x > ../f; cat src/a.mjs", "cat src/a.mjs || printf a >> src/a.mjs", "cat src/a.mjs; touch x"]) {
      const verdict = classifyShellCommand(command, p.ctx());
      assert.notEqual(verdict.kind, "allow", command);
      if (verdict.kind === "split") assert.ok(verdict.parts.every((part) => !/>|touch/u.test(part)), command);
      assert.notEqual(verdict.kind, "split", command);
    }
  } finally {
    p.cleanup();
  }
});

test("C-4: writes naming the run's state folder, .git/hooks or .git/config are refused, never parked", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of [
      "touch .litopencode/litgoal/lit-loop/autopilot.json.digest", "cp src/a.mjs .litopencode/litgoal/lit-loop/x.json", "mkdir -p .litopencode/litgoal/new",
      "cat src/a.mjs > .litopencode/litgoal/lit-loop/autopilot.json", "cp ok.mjs .git/hooks/pre-commit", "touch .git/config", "mv x .git/hooks/post-checkout"
    ]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
  } finally {
    p.cleanup();
  }
});

test("C-5: the whole link chain is followed; a dangling end in a protected root and a loop are refused", () => {
  const p = project(["read", "write", "execute"]);
  const fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-shell-home-")));
  try {
    fs.mkdirSync(path.join(fakeHome, "opencode"));
    fs.symlinkSync(path.join(fakeHome, "opencode", "not-yet.json"), path.join(p.root, "hop2"));
    fs.symlinkSync(path.join(p.root, "hop2"), path.join(p.root, "hop1"));
    fs.symlinkSync(path.join(p.root, "loop-b"), path.join(p.root, "loop-a"));
    fs.symlinkSync(path.join(p.root, "loop-a"), path.join(p.root, "loop-b"));
    const ctx = p.ctx({ protectedRoots: [path.join(fakeHome, "opencode")] });
    for (const command of ["touch hop1", "cat hop1", "cp src/a.mjs hop1", "touch loop-a", "cat loop-b"]) {
      assert.equal(classifyShellCommand(command, ctx).kind, "refuse", command);
    }
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
    p.cleanup();
  }
});

test("a mutating command whose operand holds the run's state folder or .git is refused, in any letter case", () => {
  const p = project(["read", "write", "execute"]);
  try {
    const stateFile = path.join(p.root, ".litopencode", "litgoal", "lit-loop", "autopilot.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{}");
    const ctx = p.ctx({ protectedRoots: [stateFile] });
    for (const command of ["rm -rf .litopencode", "rm -rf .", "mv .litopencode old", "rm -r .LITOPENCODE", "mv .LitOpenCode/LitGoal x", "cd src && rm -rf ..", "git clean -fdx .", "find . -delete", "cp -r src .litopencode/litgoal", "chmod -R 000 .litopencode", "tar -xf x.tar -C ."]) {
      assert.equal(classifyShellCommand(command, ctx).kind, "refuse", command);
    }
    for (const command of ["ls .litopencode", "grep -rn rm src", "rm -rf build", "cp -r src ."]) {
      assert.notEqual(classifyShellCommand(command, ctx).kind, "refuse", command);
    }
  } finally {
    p.cleanup();
  }
});

test("~/ operands are read as home paths; git show REV:.env, grep -f and sort --compress-program never pass", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["cat ~/.ssh/id_rsa", "echo x > ~/.zshrc", "cp src/a.mjs ~/.config/opencode/x.json", "git show HEAD:.env", "git show HEAD:config/.env.local", "cat ~/.npmrc"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["cat ~/notes.txt", "grep -f ../outside/p src/a.mjs", "grep -rf ../p src", "rg -f ../p src", "sort --compress-program=gzip src/a.mjs", "sort --compress-program gzip src/a.mjs"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
  } finally {
    p.cleanup();
  }
});

test("review H1: sort is a reader only with its plain ordering flags; clusters and long-option prefixes never pass", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["sort -n src/a.mjs", "sort -rn -k 2 -t , src/a.mjs", "sort -u src/a.mjs", "sort -f -b src/a.mjs"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    for (const command of [
      "sort -uo out.txt src/a.mjs", "sort -ro out src/a.mjs", "sort --out=../f src/a.mjs", "sort --outp out src/a.mjs",
      "sort -S 1K --compress-prog=sh src/a.mjs", "sort --compress=sh src/a.mjs", "sort -T /tmp src/a.mjs", "sort --files0-from=list src/a.mjs",
      "file --comp src/a.mjs", "file --compile src/a.mjs", "file -zC src/a.mjs"
    ]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
  } finally {
    p.cleanup();
  }
});

test("review H2: the protected check follows each cd, and a cd into a protected folder is refused", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["cd ~/.local/share && cat opencode/auth.json", "cd ~/.config && cat gh/hosts.yml", "cd ~ && cat .ssh/id_rsa", "cd ~/.ssh && ls", "cd ~/.config/opencode", "cd src && cd ../.git && cat config"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    assert.equal(classifyShellCommand("cd src && cat a.mjs", p.ctx()).kind, "allow");
  } finally {
    p.cleanup();
  }
});

test("review M2: a write anywhere inside the git dir is refused; reads of it still run", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["tee .git/HEAD", "cp src/a.mjs .git/refs/heads/main", "echo x > .git/HEAD", "touch .git/index", "mv src/a.mjs .git/packed-refs", "cd .git && touch HEAD", "printf x >> .git/ORIG_HEAD"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["cat .git/HEAD", "git log --oneline"]) assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
  } finally {
    p.cleanup();
  }
  const w = project(["read", "write", "execute"]);
  try {
    const gitdir = path.join(w.outside, "repo.git", "worktrees", "w");
    fs.mkdirSync(path.join(w.outside, "repo.git", "refs", "heads"), { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
    fs.rmSync(path.join(w.root, ".git"), { recursive: true, force: true });
    fs.writeFileSync(path.join(w.root, ".git"), `gitdir: ${gitdir}\n`);
    const ctx = w.ctx({ grants: [{ action: "read", root: w.root }, { action: "write", root: w.root }, { action: "write", root: w.outside }] });
    for (const command of [`echo x > ${gitdir}/HEAD`, `cp src/a.mjs ${path.join(w.outside, "repo.git", "refs", "heads", "main")}`]) {
      assert.equal(classifyShellCommand(command, ctx).kind, "refuse", command);
    }
  } finally {
    w.cleanup();
  }
});

test("review Low: a recursive reader over a folder that holds a protected home is refused", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["grep -r token ~", "grep -rn token ~/", "rg token ~", "find ~ -name x", "ls -R ~", "grep -R key ~/.config"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    assert.equal(classifyShellCommand("grep -rn export src", p.ctx()).kind, "allow");
  } finally {
    p.cleanup();
  }
});

test("read-only git remote forms are local; git remote show, update and fetch stay outward", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["git remote -v | grep $X", "git remote | grep $X", "git remote get-url $R"]) {
      const verdict = classifyShellCommand(command, p.ctx());
      assert.equal(verdict.kind, "park", command);
      assert.equal(verdict.outward, false, command);
    }
    for (const command of ["git remote show origin", "git remote update", "git fetch origin", "git remote show $R", "git fetch $R"]) {
      const verdict = classifyShellCommand(command, p.ctx());
      assert.equal(verdict.kind, "park", command);
      assert.equal(verdict.outward, true, command);
    }
  } finally {
    p.cleanup();
  }
});

test("final High: jq with a library path or an import/include filter is not a reader", () => {
  const p = project(["read", "write", "execute"]);
  try {
    assert.equal(classifyShellCommand("jq -n 1", p.ctx()).kind, "allow");
    for (const command of [
      "jq -n -L ~/.config 'import \"opencode/opencode\" as $c; $c'", "jq -n -L/etc 1", "jq -n -Lsrc 1", "jq --library-path src -n 1",
      "jq -n 'include \"x\"; 1'", "jq -n 'import \"x\" as $y; 1'"
    ]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
  } finally {
    p.cleanup();
  }
});

test("final Low: a copy or move into the project root is checked as dest/basename, not as a holder", () => {
  const p = project(["read", "write", "execute"]);
  try {
    fs.writeFileSync(path.join(p.root, "src", "b.mjs"), "");
    for (const command of ["cp ../x .", "mv src/b.mjs .", "cp -t . src/b.mjs", "cp src/b.mjs src/c.mjs"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["rm -rf .", "mv . ../elsewhere", "mv .git ../g", "cp src/b.mjs .git/HEAD", "cp -t .git src/b.mjs", "chmod -R 000 ."]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
  } finally {
    p.cleanup();
  }
});

test("final Low: git remote get-url and --verbose are readers like bare and -v", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["git remote", "git remote -v", "git remote --verbose", "git remote get-url origin", "git remote get-url --push origin"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    for (const command of ["git remote show origin", "git remote add x ../y", "git remote set-url origin ../y"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
  } finally {
    p.cleanup();
  }
});

test("final same-class: attached grep patterns, grep -d recurse, diff -r, find -L, cp -R sources and -t, git -C clean, stash -u, globs, index paths", () => {
  const p = project(["read", "write", "execute"]);
  try {
    fs.writeFileSync(path.join(p.outside, "secret.txt"), "x");
    const outsideFile = path.relative(p.root, path.join(p.outside, "secret.txt"));
    for (const command of [`grep -eX ${outsideFile}`, `grep --regexp=X ${outsideFile}`, `rg -eX ${outsideFile}`, `grep -e X ${outsideFile}`]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
    }
    fs.writeFileSync(path.join(p.root, ".env"), "TOKEN=x");
    fs.writeFileSync(path.join(p.root, ".env.local"), "TOKEN=x");
    for (const command of [
      "grep -d recurse token ~", "grep --directories=recurse token ~", "diff -r ~ src", "diff --recursive ~/.config src", "find -L ~ -name x", "find -H ~", "find -P ~/.config",
      "cp -R ~ backup", "cp -r ~/.config backup", "cp -t ~/.ssh src/a.mjs",
      "git -C . clean -fdx", "git -C src clean -fd ../.litopencode", "git clean -fdx", "git stash -u", "git stash --include-untracked", "git stash push -a",
      "cat .env*", "cat .en?", "git show :.env", "git show :0:.env", "git show HEAD:.env"
    ]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["cat src/*.mjs", "cat nothing*.txt", "cat [[:alpha:]]x"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "allow", command);
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
  } finally {
    p.cleanup();
  }
});

test("lows: recursive mode is per segment, and -a counts as recursive only for cp", () => {
  const p = project(["read", "write", "execute"]);
  const previous = process.env.HOME;
  process.env.HOME = path.dirname(p.root);
  try {
    for (const command of ["ls -la ..", "grep -r export src && ls ~", "diff -a src/a.mjs ok.mjs", "grep -a export ~/notes.txt"]) {
      assert.notEqual(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["ls -R ..", "cp -a ~ backup", "grep -rn token ~"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    p.cleanup();
  }
});

test("lows: jq -L is refused, never parked, so lit approve x cannot replay it; git stash long-option prefixes are refused", () => {
  const p = project(["read", "write", "execute"]);
  try {
    for (const command of ["jq -n -L ~/.config 'import \"opencode/opencode\" as $c; $c'", "jq -n -Lsrc 1", "jq --library-path src -n 1", "jq --library-path=src -n 1"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    for (const command of ["git stash --incl", "git stash --include-u", "git stash push --al"]) {
      assert.equal(classifyShellCommand(command, p.ctx()).kind, "refuse", command);
    }
    assert.notEqual(classifyShellCommand("git stash --index", p.ctx()).kind, "refuse");
  } finally {
    p.cleanup();
  }
});
