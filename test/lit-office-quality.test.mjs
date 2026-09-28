import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildBlocks } = require("../skills/lit-pptx/scripts/lib/slide-ast.js");
const { resolve } = require("../skills/lit-pptx/scripts/lib/layout-resolver.js");
const { render: renderHtml } = require("../skills/lit-pptx/scripts/lib/render-adapter-html.js");

test("slide decorations use template text and neutral defaults", () => {
  const template = { template: { dimensions: { width: 10, height: 7.5 } } };
  const decorations = [
    { type: "confidential_mark", x: 1, y: 1, w: 1, h: 0.3, text: "Internal review" },
    { type: "disclaimer", x: 1, y: 2, w: 4, h: 0.3, text: "Custom <note>" },
  ];
  const html = renderHtml({ deck: { title: "Example" }, slides: [{ regions: {}, decorations }] }, template);
  assert.match(html, /Internal review/u);
  assert.match(html, /Custom &lt;note&gt;/u);
  assert.match(html, /Pretendard/u);
  const fallback = renderHtml({ deck: { title: "Example" }, slides: [{ regions: {}, decorations: [{ ...decorations[1], text: undefined }] }] }, template);
  assert.match(fallback, /※ 본 문서는 대외비입니다\./u);
});

test("numeric series is an editable chart block with a populated content region", () => {
  const blocks = buildBlocks("content", "# 성장 추이\n::: chart type=bar\n| 분기 | 매출 | 영업이익 |\n| --- | ---: | ---: |\n| 1Q | 120 | 18 |\n| 2Q | 135 | 22 |\n:::");
  const chart = blocks.find((b) => b.type === "chart");
  assert.deepEqual(chart?.series, [{ name: "매출", values: [120, 135] }, { name: "영업이익", values: [18, 22] }]);
  const root = "skills/lit-pptx/templates/enrolled/AZURE-PRO/";
  const template = {
    name: "AZURE-PRO",
    mapping: readFileSync(root + "layout-mapping.yaml", "utf8"),
    capabilities: readFileSync(root + "capabilities.yaml", "utf8"),
  };
  const deck = resolve({ deck: { title: "Test", template: "AZURE-PRO" }, slides: [{ index: 1, layout: "content", blocks }] }, template);
  assert.equal(deck.slides[0].regions.chart.content.type, "chart");
});

test("excluded corporate template and unused media stay out of Office payload", () => {
  const templates = readdirSync("skills/lit-pptx/templates/enrolled");
  assert.equal(templates.includes("TEMPLATE-EXAMPLE-1"), false);
  assert.equal(existsSync("skills/lit-pptx/assets/media"), false);
});

test("Office skills give bare lit a complete labelled sample when facts are absent", () => {
  for (const id of ["lit-pptx", "lit-docx"]) {
    const body = readFileSync(`skills/${id}/SKILL.md`, "utf8");
    assert.match(body, /sample|assumption/i);
    assert.match(body, /placeholder/i);
  }
});
