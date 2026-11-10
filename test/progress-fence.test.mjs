import assert from "node:assert/strict";
import { test } from "node:test";
import { LifecycleSafetyError, parseFencedProgress } from "../src/bounded-authority.ts";

// A real OpenCode 1.19.5 text part (423 bytes, isolated QA run on 2026-11-10): the plugin's LIT ignition block,
// a blank line, then the progress fence, all in one part. The whole-part rule used to drop it.
const realJson = JSON.stringify({
  schemaVersion: 3,
  workId: "db20a911-f654-4ca6-bd0c-e6aa4f49d735",
  revision: 3,
  progressId: "qa-park-1",
  summary: "task 2 needs the sibling folder",
  boundary: { action: "read", root: "/private/tmp/claude-501/-Users-woojin-Desktop-02-Areas-01-Codes-automation-27-LITFAMILY--worktrees-autopilot-1110-litopencode/64fc7301-a6c3-4746-b31e-2a959f189006/scratchpad/qa-tierB/sibling" }
});
const fence = (json = realJson, info = "litopencode-progress") => `\`\`\`${info}\n${json}\n\`\`\``;
const realPart = `\`\`\`text\nLIT\n\`\`\`\n\n${fence()}`;

test("the real 423-byte part with the LIT ignition block before the progress fence is accepted", () => {
  assert.equal(Buffer.byteLength(realPart, "utf8"), 423);
  const progress = parseFencedProgress(realPart);
  assert.equal(progress?.workId, "db20a911-f654-4ca6-bd0c-e6aa4f49d735");
  assert.equal(progress?.revision, 3);
  assert.equal(progress?.progressId, "qa-park-1");
  assert.deepEqual(progress?.boundary, { action: "read", root: JSON.parse(realJson).boundary.root });
});

test("a separate progress fence is accepted anywhere in the part, between prose and other blocks, with CRLF too", () => {
  for (const text of [
    fence(),
    `Task 1 is done.\n\n${fence()}`,
    `${fence()}\n\nThat is the checkpoint.`,
    `\`\`\`text\nLIT\n\`\`\`\nSome prose.\n\n\`\`\`ts\nconst x = "\`\`\`";\n\`\`\`\n${fence()}\nmore prose`,
    `\`\`\`text\r\nLIT\r\n\`\`\`\r\n\r\n${fence().replaceAll("\n", "\r\n")}`,
    `~~~text\nLIT\n~~~\n${fence()}`
  ]) assert.equal(parseFencedProgress(text)?.progressId, "qa-park-1", JSON.stringify(text.slice(0, 60)));
});

test("quoted, inline, indented, nested, unclosed, mislabelled and duplicate fences stay inert", () => {
  const inert = [
    ["blockquote", `\`\`\`text\nLIT\n\`\`\`\n> ${fence().replaceAll("\n", "\n> ")}`],
    ["inline backticks", `see \`\`\`litopencode-progress ${realJson}\`\`\` here`],
    ["inline code", "`litopencode-progress`"],
    ["indented", `\`\`\`text\nLIT\n\`\`\`\n    ${fence().replaceAll("\n", "\n    ")}`],
    ["one-space indent", ` ${fence().replaceAll("\n", "\n ")}`],
    ["nested in a longer fence", `\`\`\`\`markdown\n${fence()}\n\`\`\`\``],
    ["nested in a tilde fence", `~~~\n${fence()}\n~~~`],
    ["nested in a same-length fence", `\`\`\`md\n${fence()}\n\`\`\``],
    ["unclosed", `\`\`\`text\nLIT\n\`\`\`\n\`\`\`litopencode-progress\n${realJson}\n`],
    ["info string with extra words", fence(realJson, "litopencode-progress extra")],
    ["other label", fence(realJson, "litopencode-progressx")],
    ["two progress fences", `${fence()}\n\n${fence()}`],
    ["list item", `- ${fence().replaceAll("\n", "\n  ")}`]
  ];
  for (const [name, text] of inert) assert.equal(parseFencedProgress(text), undefined, name);
});

test("a lone well-placed progress fence with bad JSON, a wrong schema or an oversized part still throws", () => {
  assert.throws(() => parseFencedProgress(`\`\`\`text\nLIT\n\`\`\`\n${fence("{not-json}")}`), LifecycleSafetyError);
  assert.throws(() => parseFencedProgress(`\`\`\`text\nLIT\n\`\`\`\n${fence(JSON.stringify({ ...JSON.parse(realJson), schemaVersion: 2 }))}`), LifecycleSafetyError);
  assert.throws(() => parseFencedProgress(`${"x".repeat(70_000)}\n${fence()}`), LifecycleSafetyError);
});
