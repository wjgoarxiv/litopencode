import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import litOpenCodePlugin from "../src/index.ts";

async function withPlugin(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-host-"));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  const hooks = await litOpenCodePlugin({ directory: root, worktree: root });
  try {
    await run(root, hooks);
  } finally {
    await hooks.dispose?.();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}

function beforeRequest(tool, callID, args) {
  return { tool, sessionID: "humanizer-host-session", callID, args };
}

test("the real system-transform hook injects the always-on humanizer rule", async () => {
  await withPlugin(async (_root, hooks) => {
    const output = { system: ["host system prompt"] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "humanizer-system-session" }, output);
    const injected = output.system.join("\n");
    assert.match(injected, /Preserve the user(?:&#39;|')s meaning/u);
    assert.match(injected, /lit-humanizer/u);
    assert.match(injected, /material risk once/u);
  });
});

test("the real pre-write hook blocks added source labels without skill activation", async () => {
  await withPlugin(async (_root, hooks) => {
    const request = beforeRequest("write", "humanizer-block", {
      filePath: "reports/final.md",
      content: "Source: draft report\n"
    });
    await assert.rejects(
      hooks["tool.execute.before"](request, { args: request.args }),
      /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u
    );
  });
});

test("clean writes pass and warning-tier wording returns as advisory context", async () => {
  await withPlugin(async (_root, hooks) => {
    const clean = beforeRequest("write", "humanizer-clean", {
      filePath: "reports/final.md",
      content: "The report contains three examples.\n"
    });
    await hooks["tool.execute.before"](clean, { args: clean.args });

    const warning = beforeRequest("write", "humanizer-warning", {
      filePath: "reports/another.md",
      content: "We delve into the measured results.\n"
    });
    await hooks["tool.execute.before"](warning, { args: warning.args });
    const output = { title: "Write", output: "Wrote reports/another.md", metadata: {} };
    await hooks["tool.execute.after"](warning, output);
    assert.match(output.output, /LIT_HUMANIZER_WARN/u);
    assert.equal(output.metadata.litopencodeHumanizerGuard?.tier, "warn");
  });
});

test("an edit may retain old findings but cannot add a new block-tier line", async () => {
  await withPlugin(async (root, hooks) => {
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "reports", "legacy.md"), "Source: existing line\nKeep this sentence.\n", "utf8");
    const safeEdit = beforeRequest("edit", "humanizer-existing", {
      filePath: "reports/legacy.md",
      oldString: "Keep this sentence.",
      newString: "Keep this clear sentence."
    });
    await hooks["tool.execute.before"](safeEdit, { args: safeEdit.args });

    const unsafeEdit = beforeRequest("edit", "humanizer-added", {
      filePath: "reports/legacy.md",
      oldString: "Keep this sentence.",
      newString: "Source: new unrequested label"
    });
    await assert.rejects(
      hooks["tool.execute.before"](unsafeEdit, { args: unsafeEdit.args }),
      /LIT_HUMANIZER_BLOCKED/u
    );
  });
});

test("Office text is checked after creation and tells the model to fix and rebuild", async () => {
  await withPlugin(async (root, hooks) => {
    const relative = "reports/minimal.pptx";
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.copyFile("skills/lit-humanizer/fixtures/office/minimal.pptx", path.join(root, relative));
    const request = beforeRequest("write", "humanizer-office", { filePath: relative });
    const output = { title: "Write", output: `Created ${relative}`, metadata: {} };
    await hooks["tool.execute.after"](request, output);
    assert.match(output.output, /LIT_HUMANIZER_OFFICE_BLOCK_HIT/u);
    assert.match(output.output, /fix the source and rebuild/iu);
  });
});

test("host-shaped calls: the pre-write hook reads the write from output.args, as OpenCode sends it", async () => {
  // OpenCode passes { tool, sessionID, callID } as the before input and the tool arguments only in output.args;
  // the after input carries args itself.
  await withPlugin(async (_root, hooks) => {
    const blocked = { tool: "write", sessionID: "humanizer-host-session", callID: "humanizer-host-block" };
    await assert.rejects(
      hooks["tool.execute.before"](blocked, { args: { filePath: "reports/final.md", content: "Source: draft report\n" } }),
      /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u
    );

    const warningArgs = { filePath: "reports/another.md", content: "We delve into the measured results.\n" };
    const warning = { tool: "write", sessionID: "humanizer-host-session", callID: "humanizer-host-warn" };
    await hooks["tool.execute.before"](warning, { args: warningArgs });
    const output = { title: "Write", output: "Wrote file successfully.", metadata: {} };
    await hooks["tool.execute.after"]({ ...warning, args: warningArgs }, output);
    assert.match(output.output, /LIT_HUMANIZER_WARN/u);
  });
});

test("the real pre-write hook refuses a negative pledge in a Korean deliverable and lets a method fact through", async () => {
  await withPlugin(async (_root, hooks) => {
    const blocked = { tool: "write", sessionID: "humanizer-host-session", callID: "humanizer-host-pledge" };
    await assert.rejects(
      hooks["tool.execute.before"](blocked, { args: { filePath: "reports/final.md", content: "동일 조건의 독립 성능 비교로 쓰지 않음.\n" } }),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    const allowed = { tool: "write", sessionID: "humanizer-host-session", callID: "humanizer-host-near-miss" };
    await hooks["tool.execute.before"](allowed, { args: { filePath: "reports/final.md", content: "이 장비는 방폭 구역에서 사용하지 않습니다. 냉각수로 쓰지 않음.\n" } });
  });
});

test("the real pre-write hook refuses a reworded negation cluster with the advice and allows a limitation line", async () => {
  const cases = JSON.parse(await fs.readFile(new URL("./fixtures/lit-humanizer/negation-cluster-cases.json", import.meta.url), "utf8"));
  const p11 = cases.positive.find((fixture) => fixture.id.startsWith("p11-"));
  const p09 = cases.positive.find((fixture) => fixture.id.startsWith("p09-"));
  const n11 = cases.negative.find((fixture) => fixture.id.startsWith("n11-"));
  await withPlugin(async (_root, hooks) => {
    const cluster = beforeRequest("write", "humanizer-host-negation", { filePath: "reports/visits.md", content: `${p11.text}\n` });
    await assert.rejects(
      hooks["tool.execute.before"](cluster, { args: cluster.args }),
      /LIT_HUMANIZER_BLOCKED rule=negation-cluster [^\n]*Say what the thing is first, then add the caveat once\. Example: write "18,420 visits in total/u
    );

    const warnArgs = { filePath: "reports/visits.md", content: `${p09.text}\n` };
    const warn = beforeRequest("write", "humanizer-host-negation-warn", warnArgs);
    await hooks["tool.execute.before"](warn, { args: warnArgs });
    const warned = { title: "Write", output: "Wrote file successfully.", metadata: {} };
    await hooks["tool.execute.after"](warn, warned);
    assert.match(warned.output, /LIT_HUMANIZER_WARN[^\n]*negation-cluster/u);
    assert.equal(warned.metadata.litopencodeHumanizerGuard?.tier, "warn");

    const plainArgs = { filePath: "reports/visits.md", content: `${n11.text}\n` };
    const plain = beforeRequest("write", "humanizer-host-limitation", plainArgs);
    await hooks["tool.execute.before"](plain, { args: plainArgs });
    const quiet = { title: "Write", output: "Wrote file successfully.", metadata: {} };
    await hooks["tool.execute.after"](plain, quiet);
    assert.equal(quiet.output, "Wrote file successfully.");
  });
});

test("a repeated pledge is judged by its occurrences: adding pledges is refused, editing between two old ones is not", async () => {
  await withPlugin(async (root, hooks) => {
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "reports", "one.md"), "이 표는 일반화가 아닙니다.\n\n본문.\n", "utf8");
    const added = beforeRequest("edit", "humanizer-pledge-added", {
      filePath: "reports/one.md", oldString: "본문.", newString: "결론이 아닙니다.\n\n순위가 아닙니다."
    });
    await assert.rejects(
      hooks["tool.execute.before"](added, { args: added.args }),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge-repeat\b/u
    );

    await fs.writeFile(path.join(root, "reports", "two.md"), "결론이 아닙니다.\n\n중간 문단입니다.\n\n순위가 아닙니다.\n", "utf8");
    const middle = beforeRequest("edit", "humanizer-pledge-middle", {
      filePath: "reports/two.md", oldString: "중간 문단입니다.", newString: "중간 문단을 고쳤습니다."
    });
    await hooks["tool.execute.before"](middle, { args: middle.args });
    const output = { title: "Edit", output: "Edited reports/two.md", metadata: {} };
    await hooks["tool.execute.after"](middle, output);
    assert.equal(output.output, "Edited reports/two.md");
  });
});

test("a deliverable outside the session directory is still checked; internal paths stay exempt wherever it is", async () => {
  // The host reports the launch directory, which can be a subfolder of the worktree; relative paths resolve against it.
  const cases = JSON.parse(await fs.readFile(new URL("./fixtures/lit-humanizer/negation-cluster-cases.json", import.meta.url), "utf8"));
  const p01 = cases.positive.find((fixture) => fixture.id.startsWith("p01-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-subdir-"));
  const sources = path.join(project, "sources");
  await fs.mkdir(path.join(project, "plans"), { recursive: true });
  await fs.mkdir(sources, { recursive: true });
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(project, "xdg");
  try {
    for (const worktree of [project, "/"]) {
      const hooks = await litOpenCodePlugin({ directory: sources, worktree });
      try {
        for (const filePath of [path.join(project, "report.md"), "../report.md"]) {
          const write = beforeRequest("write", "humanizer-subdir-write", { filePath, content: `${p01.text}\n` });
          await assert.rejects(hooks["tool.execute.before"](write, { args: write.args }), /LIT_HUMANIZER_BLOCKED rule=negation-cluster /u, filePath);
        }

        await fs.writeFile(path.join(project, "report.md"), "기존 문단입니다.\n", "utf8");
        const edit = beforeRequest("edit", "humanizer-subdir-edit", { filePath: "../report.md", oldString: "기존 문단입니다.", newString: p01.text });
        await assert.rejects(hooks["tool.execute.before"](edit, { args: edit.args }), /LIT_HUMANIZER_BLOCKED rule=negation-cluster /u);
        await fs.rm(path.join(project, "report.md"));

        for (const filePath of [path.join(project, "plans", "notes.md"), "../plans/notes.md"]) {
          const internal = beforeRequest("write", "humanizer-subdir-internal", { filePath, content: `${p01.text}\n` });
          await hooks["tool.execute.before"](internal, { args: internal.args });
          const output = { title: "Write", output: "Wrote file successfully.", metadata: {} };
          await hooks["tool.execute.after"](internal, output);
          assert.equal(output.output, "Wrote file successfully.", filePath);
        }
      } finally {
        await hooks.dispose?.();
      }
    }
  } finally {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await fs.rm(project, { recursive: true, force: true });
  }
});
