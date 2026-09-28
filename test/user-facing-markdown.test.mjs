import assert from "node:assert/strict";
import { test } from "node:test";
import { stripUserFacingBlankHtmlCommentLines, stripUserFacingHtmlCommentLines } from "../src/user-facing-markdown.ts";

test("strips single-line and multi-line HTML comments outside fenced code", () => {
  const text = [
    "Before",
    "<!-- single line -->",
    "Middle",
    "<!-- generated",
    "legacy marker",
    "-->",
    "After"
  ].join("\n");

  assert.equal(stripUserFacingHtmlCommentLines(text), ["Before", "Middle", "After"].join("\n"));
});

test("preserves HTML comments inside matching fenced code blocks", () => {
  const text = [
    "```md",
    "~~~ not a closing fence for backticks",
    "<!-- should stay in code -->",
    "```",
    "<!-- remove outside code -->",
    "~~~",
    "``` not a closing fence for tildes",
    "<!-- should also stay in code -->",
    "~~~"
  ].join("\n");

  const stripped = stripUserFacingHtmlCommentLines(text);
  assert.match(stripped, /<!-- should stay in code -->/);
  assert.match(stripped, /<!-- should also stay in code -->/);
  assert.doesNotMatch(stripped, /remove outside code/);
});

test("strips only blank HTML-comment separator lines from generated assistant text", () => {
  const text = [
    "Thought: Updating goals with MCP preview check criteria · 32ms",
    "<!-- -->",
    "<!--    -->",
    "Answer body",
    "<!-- keep meaningful comments -->",
    "```md",
    "<!-- -->",
    "```"
  ].join("\n");

  const stripped = stripUserFacingBlankHtmlCommentLines(text);
  assert.equal(stripped.match(/^<!--\s*-->$/gm)?.length, 1, "only the fenced blank HTML comment should remain");
  assert.match(stripped, /<!-- keep meaningful comments -->/);
  assert.match(stripped, /```md\n<!-- -->\n```/);
});
