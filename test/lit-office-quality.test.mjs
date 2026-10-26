import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildBlocks } = require("../skills/lit-pptx/scripts/lib/slide-ast.js");
const { resolve } = require("../skills/lit-pptx/scripts/lib/layout-resolver.js");
const { render: renderHtml } = require("../skills/lit-pptx/scripts/lib/render-adapter-html.js");
const { loadTemplate } = require("../skills/lit-pptx/scripts/lib/template-registry.js");

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
  // A chart travels as a table block that carries its chart spec, so any layout that takes a table
  // takes a chart, and a renderer without charts still shows the numbers.
  const blocks = buildBlocks("content", "# 성장 추이\n::: chart type=bar\n| 분기 | 매출 | 영업이익 |\n| --- | ---: | ---: |\n| 1Q | 120 | 18 |\n| 2Q | 135 | 22 |\n:::");
  const chart = blocks.find((b) => b.chart);
  assert.deepEqual({ headers: chart?.headers, rows: chart?.rows, chart: chart?.chart }, { headers: ["분기", "매출", "영업이익"], rows: [["1Q", "120", "18"], ["2Q", "135", "22"]], chart: { type: "bar" } });
  const deck = resolve({ deck: { title: "Test", template: "AZURE-PRO" }, slides: [{ index: 1, layout: "content", blocks }] }, loadTemplate("AZURE-PRO"));
  assert.deepEqual(deck.slides[0].regions.table.content.chart, { type: "bar" });
  assert.throws(() => buildBlocks("content", "# 추이\n::: chart type=radar\n| 분기 | 매출 |\n| --- | ---: |\n| 1Q | 120 |\n:::"), /type must be one of/u);
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

// ── Tonality engine, through the installed entry points ────────────────────
// These compile real decks with `run.mjs`, so they need the office runtime in the LitOpenCode cache
// (`node skills/lit-pptx/run.mjs doctor`). Without it they skip with that reason; release evidence
// must show them run, never skipped.
const deckRoot = "skills/lit-pptx";
const runtimeEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const deckDoctor = spawnSync(process.execPath, [`${deckRoot}/run.mjs`, "doctor"], { encoding: "utf8", env: runtimeEnv });
const deckReadiness = deckDoctor.status === 0 ? JSON.parse(deckDoctor.stdout) : {};
const deckSkip = deckReadiness.nodeReady && deckReadiness.pythonReady ? false : "office runtime not in the LitOpenCode cache";
const scratch = mkdtempSync(join(tmpdir(), "litopencode-office-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function runDeck(...args) {
  return spawnSync(process.execPath, [join(process.cwd(), deckRoot, "run.mjs"), ...args], { cwd: scratch, encoding: "utf8", env: runtimeEnv });
}

function compile(name, source, ...flags) {
  const md = join(scratch, `${name}.md`);
  const pptx = join(scratch, `${name}.pptx`);
  writeFileSync(md, source);
  const result = runDeck("compile", md, ...flags, "--pptx", pptx);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { pptx, log: result.stdout };
}

function gate(pptx, ...flags) {
  const result = runDeck("qa", pptx, ...flags);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

// The cached python-pptx interpreter the deck runtime installed.
function shapesPython() {
  const lock = readFileSync(`${deckRoot}/requirements.lock`);
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "litopencode", "office");
  return join(cache, `python-pptx-${createHash("sha256").update(lock).digest("hex").slice(0, 16)}`, "bin", "python");
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Every shape on one slide as [name, x, y, w, h, text] in points, read with the cached python-pptx.
function shapes(pptx, slide) {
  const python = shapesPython();
  const code = "import json, sys\nfrom pptx import Presentation\ns = Presentation(sys.argv[1]).slides[int(sys.argv[2]) - 1]\n"
    + "print(json.dumps([[x.name, x.left / 12700, x.top / 12700, x.width / 12700, x.height / 12700, x.text_frame.text if x.has_text_frame else ''] for x in s.shapes]))";
  const result = spawnSync(python, ["-c", code, pptx, String(slide)], { encoding: "utf8", env: runtimeEnv });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Every shape on one slide as an object in points: name, box, text, largest run size, solid fill, chart or picture.
function drawn(pptx, slide) {
  const code = [
    "import json, sys",
    "from pptx import Presentation",
    "s = Presentation(sys.argv[1]).slides[int(sys.argv[2]) - 1]",
    "def fill(x):",
    "    try:",
    "        return str(x.fill.fore_color.rgb) if x.fill.type == 1 else None",
    "    except Exception:",
    "        return None",
    "out = []",
    "for x in s.shapes:",
    "    runs = [r for p in x.text_frame.paragraphs for r in p.runs] if x.has_text_frame else []",
    "    out.append({'name': x.name, 'x': x.left / 12700, 'y': x.top / 12700, 'w': x.width / 12700, 'h': x.height / 12700,",
    "                'text': x.text_frame.text if x.has_text_frame else '', 'size': max([r.font.size.pt for r in runs if r.font.size] or [0]),",
    "                'fill': fill(x), 'chart': bool(getattr(x, 'has_chart', False)), 'picture': x.shape_type == 13})",
    "print(json.dumps(out))",
  ].join("\n");
  const result = spawnSync(shapesPython(), ["-c", code, pptx, String(slide)], { encoding: "utf8", env: runtimeEnv });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// The text runs of one slide with their bold flag.
function boldRuns(pptx, slide) {
  const code = "import json, sys\nfrom pptx import Presentation\ns = Presentation(sys.argv[1]).slides[int(sys.argv[2]) - 1]\n"
    + "print(json.dumps([{'text': r.text, 'bold': bool(r.font.bold)} for x in s.shapes if x.has_text_frame for p in x.text_frame.paragraphs for r in p.runs]))";
  const result = spawnSync(shapesPython(), ["-c", code, pptx, String(slide)], { encoding: "utf8", env: runtimeEnv });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// The XML of every package part whose name matches, in name order.
function parts(file, pattern) {
  return spawnSync("unzip", ["-Z1", file], { encoding: "utf8" }).stdout.split("\n").filter((n) => pattern.test(n)).sort()
    .map((n) => spawnSync("unzip", ["-p", file, n], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout);
}

const lines = (text) => text.split(/[\n\v]/u).map((line) => line.trim()).filter(Boolean);
const findingsOf = (report, rule) => report.craft.findings.filter((f) => f.rule === rule);

const briefing = [
  "---\ntitle: 물류 거점 운영 점검\ntonality: ledger\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
  "---\nlayout: cover-typographic\n\n# 물류 거점 운영 점검\n---\n",
  "---\nlayout: section-numeral\n\n# 거점별 처리 현황\n---\n",
  "---\nlayout: table-insight\n\n## 거점별 일 처리량과 지연률\n",
  "| 거점 | 일 처리량 (건) | 지연률 |\n|---|---|---|\n| 동부 | 18,400 | 2.1% |\n| 서부 | 15,900 | 3.4% |\n| 남부 | 12,300 | 1.8% |\n| 북부 | 9,800 | 4.2% |\n",
  "- 북부 거점의 지연률이 네 곳 가운데 가장 높고 분류 설비 가동률은 가장 낮은 편이다\n- 동부 거점은 처리량이 가장 많지만 지연률은 평균보다 낮은 수준을 유지하고 있다\n출처: 예시 물류 운영 자료(2026년 9월)\n---\n",
  "---\nlayout: comparison\n\n## 분류 설비 교체안과 증설안\n",
  "### 교체안\n- 비용: 설비 네 대 교체에 12억 원, 공사 기간 6주\n- 효과: 북부 지연률을 2%대로 낮추는 것이 목표\n\n### 증설안\n- 비용: 라인 한 개 증설에 18억 원, 공사 기간 10주\n- 효과: 처리 능력 30% 확대, 지연률은 3%대 예상\n---\n",
  "---\nlayout: content\n\n## 4분기 점검 일정\n",
  "- 10월: 북부 거점 설비 진단과 교체 견적 비교를 마치고 결과를 공유한다\n- 11월: 교체 공사 착수 여부를 결정하고 협력사 일정을 확정한다\n- 12월: 교체 뒤 첫 달 지연률을 측정해 다음 분기 계획에 반영한다\n---\n",
].join("\n");

describe("lit-pptx tonality engine", { skip: deckSkip }, () => {
  it("lists thirteen tonalities beside the legacy templates and names the known ones for an unknown name", () => {
    const listed = runDeck("compile", "--list-tonalities");
    assert.equal(listed.status, 0, listed.stderr);
    for (const id of ["atlas", "bauhaus", "chalk", "computational-brutalism", "gazette", "ledger", "neo-brutalism", "newsroom", "night", "paper", "riso", "signal", "studio"]) assert.match(listed.stdout, new RegExp(`^${id} — `, "mu"));
    assert.match(listed.stdout, /^AZURE-PRO \(legacy template\)$/mu);
    const md = join(scratch, "unknown.md");
    writeFileSync(md, "---\ntitle: 확인\ntonality: marble\n---\n\n---\nlayout: content\n\n## 항목\n\n- 한 줄\n---\n");
    const unknown = runDeck("compile", md, "--pptx", join(scratch, "unknown.pptx"));
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /marble/u);
    assert.match(unknown.stderr, /ledger/u);
  });

  it("the same source under two tonalities takes different title treatments, and a legacy template keeps its single look", () => {
    const ledger = compile("ledger", briefing);
    const gazette = compile("gazette", briefing.replace("tonality: ledger", "tonality: gazette"));
    const titles = (pptx) => [3, 4, 5].map((n) => shapes(pptx, n).find(([name]) => name.startsWith("title@"))?.[0]);
    assert.notDeepEqual(titles(ledger.pptx), titles(gazette.pptx));
    assert.match(ledger.log, /Treatments: /u);
    const legacy = compile("legacy", briefing.replace("tonality: ledger", "template: AZURE-PRO"), "--template", "AZURE-PRO");
    assert.ok(shapes(legacy.pptx, 3).some(([name]) => name === "title@legacy"));
  });

  it("a section preview is a wide column of up to two lines an opened slide, run-in labels bold with their colon", () => {
    const source = [
      "---\ntitle: 도서관 이용 안내\ntonality: chalk\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
      "---\nlayout: text-column\n\n## 오늘 안내할 내용\n\n- 대출과 반납 규칙이 어떻게 바뀌는지 설명한다\n---\n",
      "---\nlayout: section\n\n# 바뀌는 대출 규칙\n---\n",
      "---\nlayout: text-column\n\n## 대출 권수와 기간\n\n- **자료:** 회원 1,200명의 9월 대출 기록, 1인 평균 3.4권\n- 한 사람이 빌릴 수 있는 책은 7권에서 10권으로 늘어난다\n- 이 세 번째 줄은 미리보기에 실리지 않는다\n---\n",
      "---\nlayout: text-column\n\n## 예시: 9월 대출 기록, 회원 1,200명\n\n- **결과** 한도까지 빌린 회원은 열 명 가운데 한 명꼴로 9월에 128명이었다\n- 대출 기간은 그대로 14일이고 한 번 연장할 수 있다\n- **주의** 이 줄도 미리보기에 실리지 않는다\n---\n",
    ].join("\n");
    const { pptx } = compile("section-preview", source);
    const page = drawn(pptx, 2).filter((s) => s.text && !s.name.startsWith("lit-notice") && !s.name.startsWith("title@"));
    const previews = page.filter((s) => /자료|빌릴 수 있는|결과|대출 기간은/u.test(s.text));
    // The support zone holds each opened slide's first line, or its first two when they fit there.
    assert.ok(previews.length >= 2, JSON.stringify(page.map((s) => s.text)));
    for (const s of previews) {
      // Eight compact columns: no wider than 70 % of the page, and most of that cap.
      assert.ok(s.w <= 0.7 * 960 + 0.5 && s.w >= 0.6 * 960, `preview ${s.w.toFixed(0)} pt wide: ${s.text}`);
      assert.ok(lines(s.text).length <= 2, `more than two lines: ${JSON.stringify(s.text)}`);
    }
    assert.ok(!page.some((s) => /실리지 않는다/u.test(s.text)), "a third line stays out of the preview");
    const runs = boldRuns(pptx, 2);
    assert.ok(runs.some((r) => r.bold && r.text === "결과:"), `a bold run-in label with its colon: ${JSON.stringify(runs)}`);
    assert.ok(runs.some((r) => r.bold && r.text === "자료:"), "a label that brings its own colon keeps one");
    assert.ok(!runs.some((r) => r.text.includes("::")), "never two colons");
    // The preview is wide on purpose, so the body-text measure (OF-102) does not judge it.
    assert.deepEqual(gate(pptx).report.craft.findings.filter((f) => f.rule === "OF-102" && f.slide === 2), []);
    // An English deck takes the narrower column of about 70 characters (six columns).
    const english = [
      "---\ntitle: Branch review\ntonality: night\n---\n",
      "---\nlayout: text-column\n\n## Loans this quarter\n\n- Loans grew 12% in the quarter\n---\n",
      "---\nlayout: section\n\n# Method notes\n---\n",
      "---\nlayout: references-appendix\n\n## Data sources and definitions\n\n- **Circulation** export from 1 July to 30 September 2026, every branch (sample).\n- [2] Q3 2026 service targets, approved June 2026 (sample).\n- [3] Overdue rate: share of loans returned after their due date.\n---\n",
    ].join("\n");
    const en = drawn(compile("section-preview-en", english).pptx, 2).filter((s) => /Circulation|service targets/u.test(s.text));
    assert.ok(en.length && en.every((s) => s.w <= 70 * 13 * 0.5 + 0.5), JSON.stringify(en.map((s) => [s.w, s.text])));
  });

  it("a contact-split closing with amounts keeps the next step clear of the total", () => {
    const source = [
      "---\ntitle: 운영 자금 요청\ntonality: studio\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
      "---\nlayout: cover-typographic\n\n# 운영 자금 요청\n---\n",
      "---\nlayout: closing-contact-split\n\n## 18개월 운영 자금 사용 계획\n",
      "| 쓰임 | 금액 |\n|---|---|\n| 권역 확대 | 14억 원 |\n| 배송 거점 | 4억 원 |\n| 품질 관리 | 7억 원 |\n| 앱 개발 인력 | 5억 원 |\n",
      "- 다음 단계: 11월 둘째 주 실사 미팅에서 세부 집행 일정과 분기별 점검 지표를 함께 확정, 담당 예시 재무팀\n---\n",
    ].join("\n");
    const { pptx } = compile("closing", source);
    const page = shapes(pptx, 2);
    const total = page.find(([, , , , , text]) => text.startsWith("합계"));
    const step = page.find(([, , , , , text]) => text.startsWith("다음 단계"));
    assert.ok(total && step, JSON.stringify(page));
    const apart = step[1] + step[3] <= total[1] || total[1] + total[3] <= step[1] || step[2] + step[4] <= total[2] || total[2] + total[4] <= step[2];
    assert.ok(apart, `next step ${JSON.stringify(step.slice(1, 5))} meets the total ${JSON.stringify(total.slice(1, 5))}`);
  });

  it("a line chart with several series reads its values off the axis, and a horizontal bar chart keeps its category labels level", () => {
    const source = [
      "---\ntitle: 응답 시간 점검\ntonality: night\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
      "---\nlayout: cover-typographic\n\n# 응답 시간 점검\n---\n",
      "---\nlayout: content\n\n## 권역별 월간 응답 시간\n",
      "::: chart type=line unit=\"ms\"\n| 월 | 동부 | 서부 | 남부 |\n|---|---|---|---|\n| 1월 | 398 | 421 | 512 |\n| 2월 | 402 | 418 | 498 |\n| 3월 | 391 | 409 | 476 |\n> 권역별 응답 시간 (예시 데이터)\n:::\n출처: 예시 운영 기록\n---\n",
      "---\nlayout: content\n\n## 원인별 장애 건수\n",
      "::: chart type=bar unit=\"건\"\n| 원인 | 건수 |\n|---|---|\n| 배포 과정의 설정 변경 실수 | 6 |\n| 외부 결제 의존 서비스 지연 | 5 |\n| 주말 처리 용량 부족 | 3 |\n| 신규 코드 결함 | 3 |\n> 원인별 장애 건수 (예시 데이터)\n:::\n출처: 예시 장애 기록\n---\n",
    ].join("\n");
    const { pptx } = compile("charts", source);
    const charts = spawnSync("unzip", ["-Z1", pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => /^ppt\/charts\/chart\d+\.xml$/u.test(n)).sort();
    const xml = charts.map((n) => spawnSync("unzip", ["-p", pptx, n], { encoding: "utf8" }).stdout);
    const line = xml.find((x) => x.includes("<c:lineChart>"));
    const bar = xml.find((x) => x.includes('<c:barDir val="bar"/>'));
    assert.ok(line && bar, charts.join(", "));
    assert.doesNotMatch(line, /<c:showVal val="1"\/>/u, "three line series with value labels print them on top of each other");
    assert.doesNotMatch(bar.slice(bar.indexOf("<c:catAx>"), bar.indexOf("</c:catAx>")), /rot="-2700000"/u, "category labels of a horizontal bar chart are slanted");
  });

  const chartsOf = (name, body, tonality = "night") => {
    const { pptx } = compile(name, `---\ntitle: 물류 지표 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\n${body}\n---\n`);
    return spawnSync("unzip", ["-Z1", pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => /^ppt\/charts\/chart\d+\.xml$/u.test(n)).sort()
      .map((n) => spawnSync("unzip", ["-p", pptx, n], { encoding: "utf8" }).stdout);
  };

  it("horizontal bars with negative values put their category labels at the axis minimum, off the bars", () => {
    const [chart] = chartsOf("negative-bars", "layout: content\n\n## 거점별 처리 비용 증감\n\n::: chart type=bar unit=\"억 원\"\n| 거점 | 증감 (억 원) |\n|---|---|\n| 동부 | 6 |\n| 서부 | 2 |\n| 남부 | -1 |\n| 북부 | -4 |\n> 거점별 처리 비용 증감 (예시 데이터)\n:::\n출처: 예시 물류 정산 자료", "ledger");
    assert.match(chart.slice(chart.indexOf("<c:catAx>"), chart.indexOf("</c:catAx>")), /<c:tickLblPos val="low"\/>/u, "labels at the zero line sit on the negative bars");
  });

  it("a missing cell is a gap in its line chart, never a point at zero", () => {
    const [chart] = chartsOf("blank-cells", "layout: content\n\n## 거점별 월간 지연률\n\n::: chart type=line unit=\"%\"\n| 월 | 동부 (%) | 북부 (%) |\n|---|---|---|\n| 6월 | 2.3 | 4.6 |\n| 7월 | 2.2 | 4.4 |\n| 8월 | 2.1 | — |\n| 9월 | 2.0 |  |\n> 거점별 지연률 (예시 데이터)\n:::\n출처: 예시 물류 운영 자료");
    const second = chart.slice(chart.lastIndexOf("<c:ser>"));
    const points = [...second.slice(second.indexOf("<c:val>")).matchAll(/<c:pt idx="(\d)"><c:v>([^<]*)<\/c:v>/gu)].map((m) => [Number(m[1]), m[2]]);
    assert.deepEqual(points.filter(([i, v]) => i >= 2 && v !== ""), [], `north has no August or September figure, yet points are drawn: ${JSON.stringify(points)}`);
    assert.match(chart, /<c:dispBlanksAs val="gap"\/>/u);
  });

  it("thin clustered horizontal bars read their values off the axis, and a narrow horizontal bar chart keeps few axis numbers", () => {
    const [pair] = chartsOf("thin-bars", "layout: kpi-over-chart\n\n## 3분기 출고 처리 실적\n\n| 출고 건수 | 자동 분류 비중 | 평균 지연 |\n|---|---|---|\n| 56,400건 | 71% | 0.8일 |\n| 2분기 53,100건 | 2분기 64% | 2분기 1.1일 |\n\n::: chart type=bar unit=\"천 건\"\n| 거점 | 2분기 | 3분기 |\n|---|---|---|\n| 동부 | 184 | 192 |\n| 서부 | 159 | 171 |\n| 남부 | 123 | 130 |\n| 북부 | 98 | 94 |\n| 중부 | 61 | 77 |\n> 거점별 분기 출고 건수 (예시 데이터)\n:::\n\n- 서부 거점이 가장 많이 늘었다\n출처: 예시 물류 운영 자료");
    assert.doesNotMatch(pair, /<c:showVal val="1"\/>/u, "value labels of two thin bars per row touch each other");
    assert.match(pair, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u);
    const grid = chartsOf("narrow-bars", "layout: dashboard-grid\n\n## Fulfilment funnel, sorting uptime and dwell time\n\n::: chart type=bar unit=\"%\"\n| Step | Share of parcels (%) |\n|---|---|\n| Received | 100 |\n| Sorted automatically | 71 |\n| Loaded same shift | 58 |\n| Delivered next day | 49 |\n> Fulfilment funnel (example data)\n:::\n\n::: chart type=line unit=\"%\"\n| Month | Uptime (%) |\n|---|---|\n| Jul | 96.4 |\n| Aug | 97.1 |\n| Sep | 97.5 |\n> Sorter uptime (example data)\n:::\n\n::: chart type=column unit=\"h\"\n| Month | Dwell (h) |\n|---|---|\n| Jul | 6.2 |\n| Aug | 5.8 |\n| Sep | 5.5 |\n> Median dwell time (example data)\n:::\n\n- Automatic sorting loses three parcels in ten");
    const funnel = grid.find((x) => x.includes('<c:barDir val="bar"/>'));
    const unit = Number(funnel.match(/<c:valAx>[\s\S]*?<c:majorUnit val="([\d.]+)"\/>/u)?.[1]);
    // Long step names leave the value axis a narrow strip; four numbers stand level there.
    assert.ok(unit > 0 && Math.ceil(100 / unit) + 1 <= 4, `axis step ${unit} on a narrow panel`);
  });

  it("a sentence as a title or cover subtitle fails the gate with a hint; a topic label passes", () => {
    const deck = (title, subtitle) => `---\ntitle: 확인\ntonality: ledger\nsubtitle: ${subtitle}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: cover-typographic\n\n# 세탁 서비스 투자 검토\n---\n\n---\nlayout: table-insight\n\n## ${title}\n\n| 항목 | 금액 (원) | 비중 |\n|---|---|---|\n| 고객 결제 | 21,000 | 100% |\n| 세탁소 정산 | 12,600 | 60% |\n| 수거·배송 | 4,100 | 20% |\n| 플랫폼 몫 | 4,300 | 20% |\n\n- 플랫폼 몫 4,300원은 수거·배송 비용 4,100원과 비슷한 규모다\n- 고객 결제의 60%는 제휴 세탁소에 정산된다\n출처: 예시 정산 자료\n---\n`;
    const bad = gate(compile("claim", deck("주문 한 건에서 남는 몫은 4,300원이다", "동네 세탁을 하루 안에 돌려준다")).pptx);
    const labels = bad.report.craft.findings.filter((f) => f.rule === "OF-114" && f.severity === "HIGH");
    assert.ok(labels.some((f) => f.slide === 2) && labels.some((f) => f.slide === 1 && /subtitle/u.test(f.value)), JSON.stringify(labels));
    assert.ok(labels.every((f) => f.hint));
    assert.equal(bad.status, 1);
    const good = gate(compile("label", deck("주문 한 건당 수익 구조", "수도권 6개 구 운영 실적과 자금 계획")).pptx);
    assert.deepEqual(good.report.craft.findings.filter((f) => f.rule === "OF-114"), []);
  });

  it("every tonality sets its deck in the bundled Pretendard pair unless the source asks for A2Z", () => {
    for (const id of ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"]) {
      const { pptx } = compile(`faces-${id}`, briefing.replace("tonality: ledger", `tonality: ${id}`));
      const xml = spawnSync("unzip", ["-p", pptx, "ppt/slides/slide4.xml"], { encoding: "utf8" }).stdout;
      const faces = new Set(xml.match(/typeface="[^"]+"/gu));
      assert.deepEqual([...faces], ['typeface="Pretendard"'], id);
    }
  });
});

// ── Regions, tonality structure, figure ground and language ────────────────
describe("lit-pptx regions, tonality structure, figure ground and language", { skip: deckSkip }, () => {
  const assets = ensureDir(join(scratch, "regions", "assets"));
  const header = (tonality) => `---\ntitle: 시립 도서관 운영 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n`;
  const oneSlide = (name, tonality, body) => {
    const built = compile(`regions/${name}`, `${header(tonality)}\n---\n${body}\n---\n`);
    return { ...built, page: drawn(built.pptx, 1) };
  };
  // Moves or resizes shapes of a compiled deck with python-pptx: a defect planted for the gate to find.
  const plant = (src, name, code) => {
    const out = join(scratch, "regions", `${name}.pptx`);
    const result = spawnSync(shapesPython(), ["-c", `import sys\nfrom pptx import Presentation\nfrom pptx.util import Pt\np = Presentation(sys.argv[1])\n${code}\np.save(sys.argv[2])`, src, out], { encoding: "utf8", env: runtimeEnv });
    assert.equal(result.status, 0, result.stderr);
    return out;
  };
  // A diagram picture: a flat ground and three boxes joined by lines in another ink.
  const diagram = (file, ground, ink) => {
    const code = "import sys\nfrom PIL import Image, ImageDraw\nc = lambda v: tuple(int(n) for n in v.split(','))\nim = Image.new('RGB', (900, 480), c(sys.argv[2]))\nd = ImageDraw.Draw(im)\n"
      + "for x in (90, 370, 650): d.rectangle([x, 180, x + 160, 300], outline=c(sys.argv[3]), width=5)\nfor x in (250, 530): d.line([x, 240, x + 120, 240], fill=c(sys.argv[3]), width=5)\nim.save(sys.argv[1])";
    const result = spawnSync(shapesPython(), ["-c", code, join(assets, file), ground.join(","), ink.join(",")], { encoding: "utf8", env: runtimeEnv });
    assert.equal(result.status, 0, result.stderr);
  };
  const loansChart = "::: chart type=column unit=\"천 권\"\n| 월 | 전체 대출 (천 권) | 전자책 대출 (천 권) |\n|---|---|---|\n| 6월 | 27.4 | 4.1 |\n| 7월 | 31.2 | 5.0 |\n| 8월 | 33.8 | 5.9 |\n| 9월 | 29.6 | 6.3 |\n> 월별 전체 대출과 전자책 대출 (예시 데이터)\n:::\n\n- 월 대출은 6월 2만 7,400권에서 8월 3만 3,800권으로 늘었다\n- 전자책 대출은 넉 달 내내 늘어 9월에 6,300권이 되었다\n- 출처: 예시 시립 도서관 대출 기록";

  it("a bottom-anchor and a side-rail title are styles on the shared title zone, and the gate fails a title moved off it (OF-113)", () => {
    const slide = (style, title) => `layout: chart-insight\ntitle: ${style}\n\n## ${title}\n\n${loansChart}`;
    const long = "중앙관과 분관 두 곳을 합한 월별 전체 대출과 전자책 대출 추이, 2026년 6월부터 9월까지 넉 달";
    const { pptx } = compile("regions/styles", `${header("paper")}\n---\n${slide("bottom-anchor", "월별 전체 대출과 전자책 대출 추이")}\n---\n\n---\n${slide("side-rail", long)}\n---\n\n---\n${slide("top-rule", "월별 전체 대출과 전자책 대출 추이")}\n---\n`);
    const pages = [1, 2, 3].map((n) => drawn(pptx, n));
    const titles = ["bottom-anchor", "side-rail", "top-rule"].map((style, i) => pages[i].find((s) => s.name === `title@${style}`));
    assert.ok(titles.every(Boolean), JSON.stringify(pages.map((page) => page.map((s) => s.name))));
    for (const t of titles) assert.deepEqual([t.x, t.y, t.w, t.h].map(Math.round), [24, 36, 756, 72], t.name);
    // Bottom-anchor closes the title zone with a heavy rule across the body; side-rail sets a bar in the left margin.
    const box = (page) => JSON.stringify(page.map((s) => [s.name, s.x, s.y, s.w, s.h]));
    assert.ok(pages[0].some((s) => s.fill && Math.round(s.y) === 110 && s.h >= 2 && s.h <= 4 && s.w >= 0.9 * 912), box(pages[0]));
    assert.ok(pages[1].some((s) => s.fill && s.x <= 1 && s.w <= 14 && s.y <= 36 && s.y + s.h >= 108), box(pages[1]));
    // Under every style the body starts on the body zone, never beside or over the title.
    for (const page of pages) {
      const ink = page.filter((s) => (s.text || s.chart) && !s.name.startsWith("title@") && !s.name.startsWith("lit-notice"));
      assert.ok(Math.min(...ink.map((s) => s.y)) >= 120 - 0.5, JSON.stringify(ink.map((s) => [s.name, s.y])));
    }
    const report = gate(pptx).report;
    assert.deepEqual([...findingsOf(report, "OF-110"), ...findingsOf(report, "OF-113"), ...findingsOf(report, "OF-115")], []);
    // The old bottom geometry (the title moved down onto the floor) is a title off the shared zone.
    const down = plant(pptx, "bottom-down", "t = next(x for x in p.slides[0].shapes if x.name.startswith('title@'))\nt.top = Pt(414)");
    assert.ok(findingsOf(gate(down).report, "OF-113").some((f) => f.severity === "HIGH"), "a title moved off the zone is reported");
  });

  it("beside a chart the source and note close the takeaway column instead of running across the body", () => {
    const { pptx, page } = oneSlide("strip-column", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 분기별 대출 실적과 계획 추이\n\n::: chart type=column unit=\"천 권\"\n| 분기 | 실적 (천 권) | 계획 (천 권) | 전년 (천 권) | 목표 (천 권) |\n|---|---|---|---|---|\n| 25년 2Q | 71 | 69 | 64 | 70 |\n| 25년 3Q | 78 | 75 | 66 | 77 |\n| 25년 4Q | 80 | 79 | 69 | 80 |\n| 26년 1Q | 84 | 82 | 71 | 83 |\n| 26년 2Q | 88 | 86 | 78 | 87 |\n| 26년 3Q | 94 | 90 | 82 | 92 |\n> 분기별 대출 실적과 계획 (예시 데이터)\n:::\n\n- 대출은 다섯 분기 연속 늘었고 여섯 분기 모두 계획을 넘었다\n- 3분기 대출은 전년 같은 분기보다 15% 늘었다\n- 출처: 예시 시립 도서관 분기 대출 기록(2025년 2분기-2026년 3분기), 연간 운영 계획\n- 주: 계획은 각 연도 1월에 확정한 분기 목표");
    const plot = page.find((s) => s.chart);
    const strip = page.find((s) => s.text.startsWith("출처:"));
    const points = page.filter((s) => /^(대출은 다섯|3분기 대출은)/u.test(s.text));
    if (points.every((s) => s.x >= plot.x + plot.w - 0.5)) {
      assert.ok(strip.x >= plot.x + plot.w - 0.5, `the strip stands in the takeaway column: chart ${JSON.stringify(plot)}, strip ${JSON.stringify(strip)}`);
      assert.ok(plot.y + plot.h >= 440, `the chart runs down to the floor: ${plot.y + plot.h}`);
    } else {
      // Two short points cannot fill a column beside the chart: they run under it and the strip closes the foot.
      assert.ok(points.every((s) => s.y >= plot.y + plot.h - 0.5) && plot.w >= 0.9 * 912, JSON.stringify({ plot, points }));
    }
    assert.ok(strip.y + strip.h >= 440, `the strip stands at the foot: ${strip.y + strip.h}`);
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
  });

  it("compact process rows reach across the body, and a closing summary keeps its source as the strip", () => {
    const proc = oneSlide("process-rows", "chalk", "layout: process\ntitle: top-rule\n\n## 희망 도서 구입 4단계 절차와 점검 항목\n\n- **1. 신청** 회원이 누리집에서 신청하면 담당 사서를 배정한다\n  (1) 도구 희망 도서 관리 화면 · 약 3분\n  (2) 확인 회원 번호와 도서 정보 · 예제 하루 40건\n- **2. 검토** 소장 여부와 선정 기준을 본다\n  (1) 기준 중복 소장, 출간 연도 · 3개 항목\n  (2) 결과 승인 82% · 반려는 사유를 알린다\n- **3. 주문** 승인한 도서를 납품 업체에 주문한다\n  (1) 도구 구매 시스템 · 주 2회 묶음 주문\n  (2) 결과 평균 입고 6일 · 품절은 회원에게 알린다\n- **4. 비치** 등록을 마치고 신청자에게 먼저 빌려준다\n  (1) 도구 장서 관리 시스템 · 약 5분\n  (2) 기한 입고 후 2일 이내 · 9월 평균 1.3일\n- 출처: 예시 희망 도서 처리 기준, 표 2 (예시)");
    const rests = proc.page.filter((s) => /^(회원이 누리집에서|소장 여부와|승인한 도서를|등록을 마치고)/u.test(s.text));
    assert.equal(rests.length, 4, JSON.stringify(proc.page.map((s) => s.text.slice(0, 12))));
    // At body size the reading measure used to stop near the middle and leave the right third of the body empty.
    for (const r of rests) assert.ok(r.x + r.w >= 24 + 912 * 0.75, `what happens reaches across: ${(r.x + r.w).toFixed(0)}`);
    assert.deepEqual(findingsOf(gate(proc.pptx).report, "OF-115"), []);
    const close = oneSlide("closing-strip", "chalk", "layout: closing-summary-list\n\n## 이번 주 정리와 과제\n\n- 희망 도서는 이틀 안에 검토 결과를 알린다\n- 반려 사유는 신청 화면에 함께 남긴다\n- 과제: 9월 신청 기록으로 분야별 승인 비율표를 만들어 목요일까지 낸다\n- 출처: 예시 사서 실무 교육 자료, 2026 (예시)");
    const source = close.page.find((s) => s.text.startsWith("출처:"));
    assert.ok(source, JSON.stringify(close.page.map((s) => s.text.slice(0, 12))));
    assert.ok(!/^\d+$/u.test(close.page[close.page.indexOf(source) - 1]?.text ?? ""), "the source is no numbered summary row");
    assert.ok(source.h <= 24, `the source is set as the strip: ${JSON.stringify(source)}`);
  });

  it("a title panel over a picture runs down the title's columns, and Atlas sets a quote on the whole-page field", () => {
    const drawImage = spawnSync(shapesPython(), ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB', (960, 540), (160, 172, 184)).save(sys.argv[1])", join(assets, "hall.png")], { encoding: "utf8", env: runtimeEnv });
    assert.equal(drawImage.status, 0, drawImage.stderr);
    const source = [
      "---\ntitle: 중앙관 열람실 재배치\ntonality: atlas\ndate: 2026-10-02\ndepartment: 예시 시설 관리팀\npresenter: 예시 담당자\nnotice: 예시 이미지 데이터 — 실제 자료로 바꿔 주세요\n---\n",
      "---\nlayout: cover-full-image\n\n# 중앙관 2층 열람실 좌석 재배치\n---\n",
      "---\nlayout: image-full\n\n## 재배치 뒤의 열람실\n\n![도 1. 재배치 뒤의 열람실 | 출처: 예시 이미지](assets/hall.png)\n---\n",
      "---\nlayout: quote\n\n## 이용자 의견\n\n“창가 자리가 늘어서 오후에도 책 읽기가 편해졌어요.”\n\n— 예시 이용자 인터뷰, 평일 오후 이용자, 이용 2년 차\n---\n",
    ].join("\n");
    const { pptx } = compile("regions/atlas", source);
    const cover = drawn(pptx, 1);
    const title = cover.find((s) => s.name === "title@cover");
    const panel = cover.find((s) => s.fill && s.y <= title.y && s.y + s.h >= title.y + title.h && s.w < 960);
    assert.ok(panel, JSON.stringify(cover.map((s) => [s.name, s.fill, s.x, s.y, s.w, s.h])));
    // The title keeps the cover zone of every tonality; the panel is the page's height over the columns left of the side zone.
    assert.deepEqual([title.x, title.y, title.w, title.h].map(Math.round), [24, 144, 678, 168]);
    assert.ok(panel.y <= 0.5 && panel.y + panel.h >= 539.5, `the panel runs the page's height: ${panel.y}-${panel.y + panel.h}`);
    assert.ok(panel.x <= 0.5 && panel.x + panel.w >= title.x + title.w, `the panel covers the title's columns: ${panel.x}+${panel.w}`);
    const whole = (s) => s.fill && Math.round(s.x) === 0 && Math.round(s.y) === 0 && Math.round(s.w) === 960 && Math.round(s.h) === 540;
    assert.ok(drawn(pptx, 3).some(whole), "the quote stands on the whole-page field");
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
    // A plate (the field under part of the page, its title in the display zone, nothing above it) is reported.
    const plate = plant(pptx, "atlas-plate", "s = p.slides[2]\nf = next(x for x in s.shapes if x.left == 0 and x.top == 0 and x.width == p.slide_width)\nf.top = Pt(120)\nf.height = Pt(420)");
    const hit = findingsOf(gate(plate).report, "OF-115");
    assert.ok(hit.some((f) => f.slide === 3 && /open page|plate/u.test(f.value)), JSON.stringify(hit));
  });

  it("two tonalities of one source set every title and the body's corner in the same places (OF-116 with --sibling)", () => {
    const lecture = [
      header("chalk"),
      "---\nlayout: cover-typographic\n\n# 자료 검색 입문\n---\n",
      "---\nlayout: text-column\n\n## 3강 학습 목표\n\n- 주제어와 키워드가 답하는 질문을 구분한다\n- 검색 결과 수를 보고 검색식을 고친다\n- 소장 정보를 청구기호로 읽는다\n---\n",
      "---\nlayout: method\n\n## 검색식과 연산자\n\n- **AND** 두 낱말이 모두 든 자료만 찾는다\n- **OR** 둘 가운데 하나라도 든 자료를 찾는다\n- **절단 검색** 낱말 끝에 별표를 붙여 변형을 함께 찾는다\n---\n",
      "---\nlayout: chart-insight\n\n## 검색식별 결과 수와 적합 비율\n\n| 검색식 | 결과 수 (건) | 적합 비율 (%) |\n|---|---|---|\n| 기후 | 1,840 | 12 |\n| 기후 AND 농업 | 214 | 38 |\n| 기후 AND 농업 AND 한국 | 61 | 64 |\n| 기후* AND 농업 | 302 | 41 |\n| 기후 OR 기상 | 2,950 | 9 |\n\n> 검색식별 결과 수와 적합 비율 (예시 데이터)\n\n- AND를 하나 더할 때마다 결과 수가 크게 줄었다\n- 결과가 60건 안팎일 때 적합 비율이 가장 높았다\n- 출처: 예시 실습 검색 기록\n---\n",
      "---\nlayout: process\n\n## 검색 4단계\n\n- **1. 묻기** 찾으려는 질문을 한 문장으로 적는다\n- **2. 고르기** 질문에서 핵심 낱말 두세 개를 고른다\n- **3. 잇기** 연산자로 낱말을 이어 검색식을 만든다\n- **4. 고치기** 결과 수를 보고 낱말을 더하거나 뺀다\n---\n",
      "---\nlayout: comparison\n\n## 목록 검색과 통합 검색\n\n:::: columns 1fr 1fr\n::: col\n- **목록 검색**\n  (1) 범위: 도서관이 소장한 단행본과 학위 논문\n  (2) 결과 수: 같은 검색식에서 평균 120건\n  (3) 장점: 청구기호와 대출 상태를 바로 보여 준다\n  (4) 한계: 학술지 기사 본문은 찾지 못한다\n:::\n::: col\n- **통합 검색**\n  (1) 범위: 소장 자료와 구독 데이터베이스의 기사\n  (2) 결과 수: 같은 검색식에서 평균 2,300건\n  (3) 장점: 기사 원문으로 바로 이어진다\n  (4) 한계: 결과가 많아 검색식을 더 좁혀야 한다\n:::\n::::\n\n- 출처: 예시 실습 검색 기록\n---\n",
      "---\nlayout: table-insight\n\n## 자료 유형별 평균 결과 수\n\n| 자료 유형 | 평균 결과 (건) | 최대 결과 (건) |\n|---|---|---|\n| 단행본 | 120 | 840 |\n| 학술지 기사 | 380 | 2,100 |\n| 학위 논문 | 45 | 260 |\n\n- 학술지 기사의 결과 수가 가장 많다\n- 출처: 예시 실습 자료, 표 1\n---\n",
      "---\nlayout: closing-summary-list\n\n## 이번 주 정리\n\n- AND는 결과를 좁힌다\n- 결과 수를 보고 검색식을 고친다\n- 과제: 같은 질문을 두 검색식으로 찾아 결과 수를 비교해 온다\n---\n",
    ].join("\n");
    const chalk = compile("regions/lecture-chalk", lecture);
    const paper = compile("regions/lecture-paper", lecture.replace("tonality: chalk", "tonality: paper"));
    const pair = gate(paper.pptx, "--sibling", chalk.pptx).report;
    assert.deepEqual(findingsOf(pair, "OF-116"), [], JSON.stringify(findingsOf(pair, "OF-116")));
    // One tonality that moves a content title down by a line is reported against the other.
    const moved = plant(paper.pptx, "paper-moved", "t = next(x for x in p.slides[1].shapes if x.name.startswith('title@'))\nt.top = t.top + Pt(30)");
    const same = gate(moved, "--sibling", chalk.pptx);
    const hit = findingsOf(same.report, "OF-116");
    assert.ok(hit.length === 1 && hit[0].severity === "HIGH" && /slide 2 title at/u.test(hit[0].value), JSON.stringify(hit));
    assert.notEqual(same.status, 0);
  });

  it("a dark tonality draws a figure's dark variant beside it, and the gate fails a light figure card on a dark ground", () => {
    diagram("route.png", [255, 255, 255], [45, 45, 45]);
    const body = "layout: figure-academic\n\n## Three-desk return route\n\n![Figure 2. Return route used at every branch | Source: synthetic sample diagram](assets/route.png)\n\n- Returns pass three desks along the counter\n- Hand-offs at one and two thirds of the counter\n- Source: Figure 2, route used at all 6 branches (sample)";
    const placed = (name, tonality) => compile(`regions/${name}`, `---\ntitle: Return desk review\ntonality: ${tonality}\nnotice: "Sample data: replace with real figures"\n---\n\n---\n${body}\n---\n`).pptx;
    const media = (pptx) => spawnSync("unzip", ["-Z1", pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => n.startsWith("ppt/media/"))
      .map((n) => createHash("sha256").update(spawnSync("unzip", ["-p", pptx, n], { maxBuffer: 64 * 1024 * 1024 }).stdout).digest("hex"));
    const sha = (file) => createHash("sha256").update(readFileSync(join(assets, file))).digest("hex");
    const light = findingsOf(gate(placed("light", "night")).report, "OF-117");
    assert.ok(light.some((f) => f.severity === "HIGH" && f.slide === 1), JSON.stringify(light));
    diagram("route.dark.png", [16, 20, 26], [228, 234, 240]);
    const dark = placed("dark", "night");
    assert.ok(media(dark).includes(sha("route.dark.png")), "the dark variant is the picture drawn");
    assert.deepEqual(findingsOf(gate(dark).report, "OF-117"), []);
    assert.ok(media(placed("paper", "paper")).includes(sha("route.png")), "a light tonality keeps the figure as written");
  });

  it("a chart puts the accent on its current series: the latest period, else the measured series over a plan, else the last", () => {
    const colours = (name, tonality, head) => {
      const { pptx } = oneSlide(name, tonality, `layout: chart-insight\n\n## Monthly loans\n\n| Month | ${head[0]} | ${head[1]} |\n|---|---|---|\n| Jun | 2,740 | 2,410 |\n| Jul | 3,120 | 2,630 |\n| Aug | 3,380 | 2,790 |\n| Sep | 2,960 | 2,550 |\n\n> Monthly loans (sample data)\n\n- Every month beat the comparison.`);
      return parts(pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0].split("<c:ser>").slice(1).map((ser) => (/<c:spPr>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/u.exec(ser) || [])[1]);
    };
    assert.equal(colours("accent-year", "night", ["2026", "2025"])[0], "E3A857", "2026 is the current year");
    assert.equal(colours("accent-quarter", "night", ["Q3 loans (k)", "Q2 loans (k)"])[0], "E3A857", "Q3 is the current quarter");
    assert.equal(colours("accent-later", "night", ["Q2 overdue (%)", "Q3 overdue (%)"])[1], "E3A857");
    assert.equal(colours("accent-plan", "ledger", ["실적 (권)", "계획 (권)"])[0], "0E6B5A", "the measured series over its plan");
    assert.equal(colours("accent-last", "paper", ["Counter desk (%)", "Self-service (%)"])[1], "8C1C2B", "else the last series");
  });

  it("chart data labels keep the decimals the table writes (29.0 stays 29.0)", () => {
    const one = oneSlide("decimals", "signal", "layout: chart-insight\n\n## 월별 전체 대출과 전자책 대출\n\n| 월 | 전체 대출 (천 권) | 전자책 대출 (천 권) |\n|---|---|---|\n| 7월 | 31.2 | 5.0 |\n| 8월 | 33.8 | 5.9 |\n| 9월 | 29.0 | 6.3 |\n\n> 월별 대출 (예시 데이터)\n\n- 9월 대출은 2만 9천 권이다");
    assert.match(parts(one.pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0], /<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0\.0"/u, "one decimal, as written");
    const whole = oneSlide("whole", "signal", "layout: chart-insight\n\n## 연간 대출\n\n| 연도 | 대출 (권) |\n|---|---|\n| 2024 | 318,400 |\n| 2025 | 336,900 |\n| 2026 | 352,100 |\n\n> 연간 대출 (예시 데이터)\n\n- 2026년 대출은 전년보다 5% 늘었다");
    assert.match(parts(whole.pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0], /<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0"/u);
  });

  it("Korean text runs carry lang ko-KR in tonality and legacy decks, and Latin-only runs keep en-US", () => {
    const tagged = (xml) => [...xml.matchAll(/<a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t>/gu)].map((m) => ({
      text: m[2], lang: (/\blang="([^"]+)"/u.exec(m[1]) || [])[1], alt: (/\baltLang="([^"]+)"/u.exec(m[1]) || [])[1],
    }));
    const { pptx } = oneSlide("language", "ledger", "layout: chart-insight\n\n## 주 2회 상호대차, 3분기 신청 추이\n\n| 월 | 신청 (천 건) |\n|---|---|\n| 7월 | 1.4 |\n| 8월 | 1.7 |\n| 9월 | 2.0 |\n\n> 월별 상호대차 신청 (예시)\n\n- 9월 신청은 Q3 최고치다 (예시)\n- Q3 2026");
    const runs = parts(pptx, /^ppt\/slides\/slide\d+\.xml$/u).flatMap(tagged);
    const korean = runs.filter((r) => /[가-힣]/u.test(r.text));
    assert.ok(korean.length > 3 && korean.every((r) => r.lang === "ko-KR" && r.alt === "en-US"), JSON.stringify(korean.filter((r) => r.lang !== "ko-KR")));
    assert.ok(runs.some((r) => r.text === "Q3 2026" && r.lang === "en-US"));
    assert.match(parts(pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0], /<c:lang val="ko-KR"\/>/u, "a chart with Korean labels is a Korean chart");
    const legacy = compile("regions/language-legacy", briefing.replace("tonality: ledger", "template: AZURE-PRO"), "--template", "AZURE-PRO");
    const legacyRuns = parts(legacy.pptx, /^ppt\/slides\/slide\d+\.xml$/u).flatMap(tagged).filter((r) => /[가-힣]/u.test(r.text));
    assert.ok(legacyRuns.length > 3 && legacyRuns.every((r) => r.lang === "ko-KR"), JSON.stringify(legacyRuns.filter((r) => r.lang !== "ko-KR").slice(0, 3)));
  });
});

describe("lit-pptx short columns, run-in labels, agenda and small parts", { skip: deckSkip }, () => {
  const assets = ensureDir(join(scratch, "fill", "assets"));
  const header = (tonality) => `---\ntitle: 시립 도서관 운영 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n`;
  const oneSlide = (name, tonality, body) => {
    const built = compile(`fill/${name}`, `${header(tonality)}\n---\n${body}\n---\n`);
    return { ...built, page: drawn(built.pptx, 1) };
  };
  const plant = (src, name, code) => {
    const out = join(scratch, "fill", `${name}.pptx`);
    const result = spawnSync(shapesPython(), ["-c", `import sys\nfrom pptx import Presentation\nfrom pptx.util import Pt\np = Presentation(sys.argv[1])\n${code}\np.save(sys.argv[2])`, src, out], { encoding: "utf8", env: runtimeEnv });
    assert.equal(result.status, 0, result.stderr);
    return out;
  };
  // A flat picture with a darker frame, at the given pixel size.
  const picture = (file, width, height) => {
    const code = "import sys\nfrom PIL import Image, ImageDraw\nw, h = int(sys.argv[2]), int(sys.argv[3])\nim = Image.new('RGB', (w, h), (222, 226, 232))\nImageDraw.Draw(im).rectangle([8, 8, w - 9, h - 9], outline=(60, 66, 76), width=6)\nim.save(sys.argv[1])";
    const result = spawnSync(shapesPython(), ["-c", code, join(assets, file), String(width), String(height)], { encoding: "utf8", env: runtimeEnv });
    assert.equal(result.status, 0, result.stderr);
  };
  // The tallest empty stretch of a text column, from `top` down to where the visual beside it ends, as a share of the body.
  const columnGap = (blocks, top, reach, floor = 486) => {
    let gap = 0;
    let cursor = top;
    for (const b of [...blocks].sort((m, n) => m.y - n.y)) { gap = Math.max(gap, b.y - cursor); cursor = Math.max(cursor, b.y + b.h); }
    return Math.max(gap, reach - cursor) / (floor - top);
  };

  it("two short takeaways beside a chart fill their column or run under the chart, and a picture beside five takeaways takes most of the body (OF-115)", () => {
    const chart = oneSlide("short-chart", "studio", "layout: chart-insight\ntitle: top-plain-large\n\n## 분관별 주말 방문자 추이\n\n::: chart type=column unit=\"천 명\"\n| 분관 | 7월 (천 명) | 8월 (천 명) | 9월 (천 명) |\n|---|---|---|---|\n| 강변 분관 | 3.2 | 3.9 | 4.4 |\n| 언덕 분관 | 2.1 | 2.6 | 3.0 |\n| 시장 분관 | 1.4 | 1.9 | 2.7 |\n> 분관 세 곳의 주말 방문자 (예시 데이터)\n:::\n\n- 세 분관 모두 석 달 연속 주말 방문자가 늘었다\n- 시장 분관이 9월에 가장 크게 늘었다(+42%)\n- 출처: 예시 시립 도서관 출입 집계(2026년 7-9월)");
    const plot = chart.page.find((s) => s.chart);
    const points = chart.page.filter((s) => /^(세 분관 모두|시장 분관이)/u.test(s.text));
    // The column holds the points and whatever the engine moved into it (the chart's values), read as the gate reads it.
    const beside = chart.page.filter((s) => s.x >= plot.x + plot.w - 1 && s.w > 20 && !s.text.startsWith("출처:"));
    if (points.every((s) => s.x >= plot.x + plot.w - 1)) {
      const top = Math.min(plot.y, ...beside.map((s) => s.y));
      assert.ok(columnGap(beside, top, Math.min(486, plot.y + plot.h)) <= 0.4, JSON.stringify(beside.map((s) => [Math.round(s.y), Math.round(s.h)])));
    } else {
      assert.ok(points.every((s) => s.y >= plot.y + plot.h - 1) && plot.w >= 0.9 * 912, `the point runs under a full-width chart: ${JSON.stringify({ plot, points })}`);
    }
    assert.deepEqual(findingsOf(gate(chart.pptx).report, "OF-115"), []);
    picture("reading.png", 1600, 900);
    const pic = oneSlide("short-picture", "signal", "layout: image-split\ntitle: bottom-anchor\n\n## 2층 열람실 좌석 이용\n\n![도 1. 재배치한 2층 열람실 | 출처: 예시 이미지](assets/reading.png)\n\n- 평일 오후 좌석 점유율은 72%로 오전의 두 배다\n- 창가 좌석 48석은 개관 30분 만에 모두 찬다\n- 노트북 좌석 이용자의 평균 체류 시간은 3.4시간이다\n- 이용자 61%가 콘센트 좌석을 더 늘려 달라고 답했다\n- 출처: 예시 열람실 좌석 관리 기록과 이용자 설문(2026년 9월)");
    const image = pic.page.find((s) => s.picture);
    assert.ok(image && image.w >= 0.55 * 912, `the picture takes more than half the body: ${JSON.stringify(image)}`);
    assert.deepEqual(findingsOf(gate(pic.pptx).report, "OF-115"), []);
    // The gate reads the band inside the column: points stacked high above the source strip leave the column open.
    const short = plant(pic.pptx, "short-planted", "k = 0\nfor sh in p.slides[0].shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('평일 오후', '창가 좌석', '노트북 좌석', '이용자 61%')):\n        sh.top, sh.height = Pt(40 + 20 * k), Pt(18)\n        k += 1");
    const hit = findingsOf(gate(short).report, "OF-115");
    assert.ok(hit.some((f) => /column beside a longer one/u.test(f.value)), JSON.stringify(hit));
  });

  it("takeaways that close with the chart's values fill their column, and the gate reads the values table as part of it (OF-115)", () => {
    // Two one-line points, the chart's values under them and the source on the floor left the column 42 % empty under the table.
    const { pptx, page } = oneSlide("values-column", "studio", "layout: asymmetric-feature\n\n## Loans by format, Q3\n\n::: chart type=bar unit=\"loans\"\n| Format | Loans |\n|---|---|\n| Print | 4,820 |\n| E-book | 3,610 |\n| Audiobook | 2,140 |\n| Magazine | 1,930 |\n> Loans by format (example data)\n:::\n\n- **Lead** Print, 39% of loans\n- **Plan** Audiobooks move to the lobby shelf\n- Source: Example branch loan records");
    const plot = page.find((s) => s.chart);
    const beside = page.filter((s) => s.x >= plot.x + plot.w - 1 && s.w > 20);
    if (page.filter((s) => /^(Lead|Plan):/u.test(s.text)).every((s) => s.x >= plot.x + plot.w - 1)) {
      const top = Math.min(plot.y, ...beside.map((s) => s.y));
      assert.ok(columnGap(beside, top, Math.min(486, plot.y + plot.h)) <= 0.4, JSON.stringify(beside.map((s) => [s.text.slice(0, 8), Math.round(s.y), Math.round(s.h)])));
    }
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
    // The same column set by hand, the table straight under the points, fails.
    const hole = plant(pptx, "values-hole", [
      "for sh in p.slides[0].shapes:",
      "    t = sh.text_frame.text if sh.has_text_frame else ''",
      "    if getattr(sh, 'has_chart', False) and sh.has_chart:",
      "        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(108), Pt(366), Pt(358)",
      "    elif t.startswith('Figure 1.'):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(472), Pt(366), Pt(14)",
      "    elif t.startswith(('Lead:', 'Plan:')):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(434), Pt(108 if t.startswith('Lead:') else 136), Pt(502), Pt(22)",
      "    elif t.startswith('Source:'):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(414), Pt(474), Pt(522), Pt(12)",
      "    elif getattr(sh, 'has_table', False) and sh.has_table:",
      "        sh.left, sh.top, sh.width = Pt(414), Pt(177), Pt(522)",
      "        for row in sh.table.rows:",
      "            row.height = Pt(140 / len(sh.table.rows))",
      "        sh.height = Pt(140)",
      "    elif sh.width < Pt(8) and sh.height < Pt(8):",
      "        sh.left = Pt(414)",
    ].join("\n"));
    const hit = findingsOf(gate(hole).report, "OF-115");
    assert.ok(hit.some((f) => /column beside a longer one/u.test(f.value)), JSON.stringify(hit));
  });

  it("a short sidebar note beside four long points stands across the top and the points run under it to the floor", () => {
    const { pptx, page } = oneSlide("sidebar", "chalk", "layout: sidebar-note\ntitle: top-rule\n\n## Four common cataloguing slips\n\n- **Copying the publisher's subtitle as the title**\n  (1) The record then sorts under a phrase no reader searches for\n  (2) Keep the subtitle in its own field after the colon\n- **Guessing the year from the copyright line**\n  (1) A reprint carries the first year and misleads the edition count\n  (2) Read the printing line on the reverse of the title page\n- **Skipping the series number**\n  (1) Volumes then shelve out of order and readers miss volume two\n  (2) Enter the number even when the spine leaves it out\n- **Leaving the language field empty**\n  (1) Filters by language drop the record; last month 41 records were missed\n  (2) Fill it from the text, not from the cover\n\n::: main-box\nCheck the title page, its reverse and the spine before you save\n:::");
    const note = page.find((s) => s.text.startsWith("Check the title page"));
    const heads = page.filter((s) => /^(Copying the publisher|Guessing the year|Skipping the series|Leaving the language)/u.test(s.text));
    assert.ok(note && heads.length === 4 && heads.every((h) => h.y > note.y + note.h), "the note stands above the points");
    // One column or two, whichever the body zone fills: the points reach the floor either way.
    const points = page.filter((s) => s.text && s.y > note.y + note.h && !s.name.startsWith("lit-notice"));
    assert.ok(new Set(heads.map((h) => Math.round(h.x))).size <= 2, `at most two columns: ${JSON.stringify(heads.map((h) => Math.round(h.x)))}`);
    assert.ok(Math.max(...points.map((s) => s.y + s.h)) >= 486 - 48, `the points reach the floor: ${JSON.stringify(points.map((s) => [s.y, s.h]))}`);
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
    // The note in a narrow column beside points that stop short of three quarters of the body is still read.
    const beside = plant(pptx, "sidebar-beside", [
      "s = p.slides[0]", "y = 120",
      "for sh in s.shapes:",
      "    t = sh.text_frame.text if sh.has_text_frame else ''",
      "    if t.startswith('Check the title page'):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(660), Pt(120), Pt(264), Pt(50)",
      "    elif sh.has_text_frame and t and not sh.name.startswith(('title@', 'lit-notice')):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(y), Pt(600), Pt(18)",
      "        y += 22",
      "    elif not sh.name.startswith(('family@', 'lit-notice', 'title@')):",
      "        sh.left, sh.top, sh.width, sh.height = Pt(648), Pt(120), Pt(288), Pt(62)",
    ].join("\n"));
    const hit = findingsOf(gate(beside).report, "OF-115");
    assert.ok(hit.some((f) => /column beside a longer one/u.test(f.value)), JSON.stringify(hit));
  });

  it("takeaways beside figure rows fill their column down to the body floor, and the gate reads that column to the floor (OF-115)", () => {
    // Four figures and four takeaways under a bottom title: the column stood open while the rows also stopped short of the floor.
    const { pptx, page } = oneSlide("kpi-floor", "signal", "layout: kpi-row\ntitle: bottom-anchor\n\n## 재개관 첫 주 열람실 지표\n\n| 하루 방문 | 하루 대출 | 신규 회원 | 좌석 점유율 |\n|---|---|---|---|\n| 1,240명 | 860권 | 312명 | 81% |\n| 공사 전 620명 | 공사 전 470권 | 어린이·보호자 61% | 공사 전 58% |\n\n- 하루 방문은 공사 전 620명에서 1,240명으로 두 배가 됐다\n- 하루 대출 860권은 공사 전보다 390권, 83% 많다\n- 신규 회원 312명 중 어린이·보호자가 61%, 약 190명이다\n- 좌석 점유율은 58%에서 81%로 23%p 올랐다\n- 출처: 예시 도서관 출입·대출 기록, 재개관 첫 주 (예시)");
    const title = page.find((s) => s.text.startsWith("재개관 첫 주"));
    const figure = page.find((s) => s.text === "1,240명");
    const points = page.filter((s) => /^(하루 방문은|하루 대출 860권|신규 회원 312명|좌석 점유율은)/u.test(s.text));
    const source = page.find((s) => s.text.startsWith("출처:"));
    assert.equal(points.length, 4);
    if (points.every((s) => s.x > figure.x + 200)) {
      assert.ok(columnGap([...points, source], figure.y, title.y, title.y) <= 0.4, JSON.stringify(points.map((s) => [s.text.slice(0, 6), Math.round(s.y), Math.round(s.h)])));
    }
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
    // The points stacked at the column's top, as before: the gate fails it though the rows beside them stop short too.
    const short = plant(pptx, "kpi-floor-planted", "k = 0\ns = p.slides[0]\nx = max(sh.left for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('출처:'))\nfor sh in s.shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('하루 방문은', '하루 대출 860권', '신규 회원 312명', '좌석 점유율은')):\n        sh.left, sh.top, sh.width, sh.height = x + Pt(20), Pt(36 + 56 * k), Pt(346), Pt(50 if k < 3 else 25)\n        k += 1\n    elif sh.width < Pt(8) and sh.height < Pt(8):\n        sh.top = Pt(4)");
    const hit = findingsOf(gate(short).report, "OF-115");
    assert.ok(hit.some((f) => /column beside a longer one/u.test(f.value)), JSON.stringify(hit));
  });

  it("summary groups of unequal length split where the two columns come out nearest even (OF-115)", () => {
    // Three, three and two points: split by count, the last group stood alone and left its column half empty.
    const { pptx, page } = oneSlide("summary-split", "gazette", "layout: summary-box-list\n\n## 개관 점검 요약과 건의\n\n::: key-message\n주말 개관을 두 시간 늘리되, 늘린 시간에는 열람실 두 곳만 연다\n:::\n\n- **점검 결과**\n  (1) 주말 방문자는 석 달 동안 평균 18% 늘었다\n  (2) 오후 4시 이후 열람실 점유율이 평일의 1.6배다\n  (3) 대출 대기 시간은 평균 6분에서 9분으로 길어졌다\n- **남은 문제**\n  (1) 주말 인력 4명 가운데 2명이 시간제 계약이다\n  (2) 냉난방 비용이 주말 하루 18만 원 늘어난다\n  (3) 반납함이 일요일 저녁마다 가득 찬다\n- **건의**\n  (1) 늘린 두 시간에는 1층과 3층 열람실만 연다\n  (2) 추가 비용은 연 1,900만 원이다\n- 출처: 예시 시립 도서관 운영 기록(2026년 7-9월)");
    const third = page.find((s) => s.text.startsWith("건의"));
    const second = page.find((s) => s.text.includes("남은 문제"));
    assert.ok(second && third && Math.abs(second.x - third.x) < 1, `the second group stands with the third: ${JSON.stringify([second, third])}`);
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-115"), []);
  });

  it("a next-step line that fits its box sets on one line across it; a longer one keeps the measure", () => {
    const { page } = oneSlide("next-step", "chalk", "layout: closing-ask\n\n## 다음 주 실습 준비물과 과제\n\n| 과제 | 분량 | 배점 | 기한 | 확인할 점 |\n|---|---|---|---|---|\n| 신착 도서 목록 정리 | 30권 이상 | 6점 | 10월 12일(월) | 청구기호 순서 |\n| 분류 번호 붙이기 | 15권 | 4점 | 10월 13일(화) | 주제 일치 |\n| 서지 기록 고치기 | 기록 10건 | 6점 | 10월 14일(수) | 표제 필드 |\n| 소감 쓰기 | 3문장 이내 | 4점 | 10월 15일(목) | 어려웠던 점 |\n\n- 과제: 다음 실습 전까지 신착 도서 30권 이상으로 목록을 직접 한 번 만들어 본다\n- 제출: 단계마다 기한까지 실습 게시판의 한 게시물에 이어서 올린다 (3주 차 과제, 총 20점)\n- 다음 시간: 주제 분류와 전거 통제, 질문은 전날까지 게시판에 (예시 강사)");
    const task = page.find((s) => s.text.startsWith("과제:"));
    assert.ok(task && lines(task.text).length === 1 && task.w >= 700, `one line across the box: ${JSON.stringify(task)}`);
    for (const s of page.filter((x) => /^(과제|제출|다음 시간):/u.test(x.text))) assert.ok(s.w >= 400, JSON.stringify(s));
  });

  it("an agenda takes no count numeral beside its title, and the gate fails one (OF-119)", () => {
    const { pptx, page } = oneSlide("agenda", "chalk", "layout: agenda\n\n## 3주 차 학습 순서\n\n- **장서 점검** 서가 순서대로 빠진 책을 찾는 방법\n- **분류 번호** 같은 주제의 책이 한곳에 모이는 까닭\n- **서지 기록** 표제와 판차를 고르는 네 단계\n- **흔한 실수** 기록을 잘못 남기는 세 가지 경우");
    const title = page.find((s) => s.name.startsWith("title@"));
    assert.notEqual(title.name, "title@kicker-numeral");
    assert.ok(!page.some((s) => s.text === "4" && s.y < 120), "no stray numeral beside the title");
    assert.ok(title.x <= 30, `the title starts at the margin: ${title.x}`);
    const planted = plant(pptx, "agenda-numeral", "s = p.slides[0]\nt = [sh for sh in s.shapes if sh.name.startswith('title@')][0]\nt.name = 'title@kicker-numeral'\nb = s.shapes.add_textbox(Pt(804), Pt(36), Pt(132), Pt(72))\nb.text_frame.text = '4'\nb.text_frame.paragraphs[0].runs[0].font.size = Pt(60)");
    assert.ok(findingsOf(gate(planted).report, "OF-119").some((f) => f.severity === "HIGH"), JSON.stringify(gate(planted).report.craft.findings.map((f) => f.rule)));
  });

  it("a pack draws a comparison in its own structure, and placement parity tolerates a point of rounding and nothing more (OF-116)", () => {
    const body = "layout: comparison\n\n## 무인 반납기와 창구 반납\n\n:::: columns 1fr 1fr\n::: col\n- **무인 반납기**\n  (1) 처리 시간: 한 권에 8초, 대기 없이 바로 반납한다\n  (2) 운영 시간: 24시간, 휴관일에도 받는다\n  (3) 설치비: 한 대 1억 4천만 원, 유지비 연 900만 원\n  (4) 오류율: 0.6%, 대부분 바코드 손상\n:::\n::: col\n- **창구 반납**\n  (1) 처리 시간: 한 권에 25초, 주말 오후 대기 12분\n  (2) 운영 시간: 개관 시간만, 휴관일에는 받지 않는다\n  (3) 설치비: 추가 비용 없음, 인건비 연 3,600만 원\n  (4) 오류율: 0.2%, 사서가 바로 확인\n:::\n::::\n\n- 출처: 예시 반납 처리 기록(2026년 9월)";
    assert.equal(oneSlide("structure-paper", "paper", body).page.find((s) => s.name.startsWith("title@")).name, "title@top-rule");
    assert.equal(oneSlide("structure-chalk", "chalk", body).page.find((s) => s.name.startsWith("title@")).name, "title@side-rail");
    // deck_output re-reads both decks; the probe swaps in fixed placements: a point of rounding passes, a moved title or body fails.
    const probe = join(scratch, "fill", "bar.py");
    writeFileSync(probe, "import sys\nsys.path.insert(0, sys.argv[1])\nimport deck_output as d\nslide = lambda n, title, body: {'n': n, 'title': title, 'body': body}\nbase = [slide(1, (24, 144, 678, 168), None), slide(2, (24, 36, 756, 72), (24, 120))]\nnear = [slide(1, (24.6, 144, 678, 168), None), slide(2, (24, 36.8, 756, 72), (24.5, 120.9))]\ntitle = [base[0], slide(2, (24, 60, 756, 72), (24, 120))]\nbody = [base[0], slide(2, (24, 36, 756, 72), (336, 120))]\nseq = iter([base, near, base, title, base, body])\nd.placement = lambda prs: next(seq)\nd.Presentation = lambda path: None\nprint(*[len(d.compare_placement('x', 'y')) for _ in range(3)])\n");
    const bar = spawnSync(shapesPython(), ["-B", probe, join(process.cwd(), deckRoot, "scripts")], { encoding: "utf8", env: runtimeEnv });
    assert.equal(bar.status, 0, bar.stderr);
    assert.equal(bar.stdout.trim(), "0 1 1", "within a point passes; a moved title or a body beside a rail fails");
  });

  it("a series keeps one colour across the deck: alone on a chart it takes the colour it has beside the highlighted series", () => {
    const { pptx } = compile("fill/series", `---\ntitle: Desk review\ntonality: paper\nnotice: "Sample data: replace with real figures"\n---\n\n---\nlayout: chart-insight\n\n## Counter-desk share of loans\n\n::: chart type=line unit="%"\n| Month | Counter desk (%) |\n|---|---|\n| Jul | 58 |\n| Aug | 52 |\n| Sep | 47 |\n:::\n\n- The counter share fell for three months\n---\n\n---\nlayout: chart-insight\n\n## Counter desk vs self-service share\n\n::: chart type=line unit="%"\n| Month | Counter desk (%) | Self-service (%) |\n|---|---|---|\n| Jul | 58 | 42 |\n| Aug | 52 | 48 |\n| Sep | 47 | 53 |\n:::\n\n- Self-service passed the counter in September\n---\n`);
    const colours = (xml) => [...xml.matchAll(/<c:ser>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/gu)].map((m) => m[1].toUpperCase());
    const [single, pair] = parts(pptx, /^ppt\/charts\/chart\d+\.xml$/u).map(colours);
    assert.equal(single[0], pair[0], `Counter desk alone ${single[0]}, beside Self-service ${pair[0]}`);
    assert.notEqual(pair[0], pair[1]);
  });

  it("a wide method figure runs across the body over its terms, and the Studio statement stands between two hairlines", () => {
    picture("flow.png", 900, 260);
    const { page } = oneSlide("method-wide", "paper", "layout: method\n\n## Three-desk return route and symbols\n\n![Figure 2. Return route at every branch | Source: synthetic sample diagram](assets/flow.png)\n\n- **Route:** returns pass three desks, at the door, the sorter and the shelf trolley\n- **t:** handling time per item, in seconds\n  (1) Timed at the sorter every 15 min, 9:00-18:00\n- **q, r:** queue length and arrival rate (items/min); q = r × t\n- **d:** number of desks open\n  (1) d = 3 on weekdays; d = 2 on Sunday\n- **s:** share of items sent to repair, %\n  (1) Six weeks sampled: 1.2, 0.9, 1.4, 1.1, 1.0 and 1.3\n- Source: Figure 2, route used at all 6 branches (sample)");
    const fig = page.find((s) => s.picture);
    const terms = page.filter((s) => /^(Route|t|q, r|d|s):/u.test(s.text));
    assert.ok(fig.w >= 450, `the wide figure is drawn wider than half the body: ${JSON.stringify(fig)}`);
    assert.ok(terms.length && terms.every((t) => t.y >= fig.y + fig.h), `terms under the figure: ${JSON.stringify(terms.map((t) => [t.text.slice(0, 8), Math.round(t.y)]))}`);
    const statement = oneSlide("statement-studio", "studio", "layout: statement\n\n## 책은 돌아와야 다시 읽힌다\n\n— 예시 관장 인사말에서").page;
    assert.ok(!statement.some((s) => s.fill && Math.round(s.x) === 0 && Math.round(s.y) === 0 && s.h >= 400 && s.w < 400), "no empty rail beside the statement");
    assert.ok(statement.filter((s) => !s.text && s.h <= 2 && s.w >= 800).length >= 2, `two hairlines: ${JSON.stringify(statement.map((s) => [s.name, Math.round(s.w), Math.round(s.h)]))}`);
  });

  it("a bold run-in label takes its colon in the engine, and the gate fails one without a separator (OF-118)", () => {
    const { pptx } = oneSlide("run-in", "signal", "layout: text-column\ntitle: top-rule\n\n## 상호대차 신청 흐름\n\n- **요약** 누리집에서 신청하면 다른 분관의 책을 사흘 안에 가까운 분관에서 받는다\n- **신청:** 회원 번호로 로그인해 책마다 받을 분관을 고른다\n- 도착하면 문자로 알리고 일주일 동안 대출 창구에 둔다");
    const runs = boldRuns(pptx, 1);
    assert.ok(runs.some((r) => r.bold && r.text === "요약:"), JSON.stringify(runs));
    assert.ok(runs.some((r) => r.bold && r.text === "신청:") && !runs.some((r) => r.text.includes("::")), "a label with its own colon keeps one");
    assert.deepEqual(findingsOf(gate(pptx).report, "OF-118"), []);
    const bare = plant(pptx, "run-in-bare", "for sh in p.slides[0].shapes:\n    if sh.has_text_frame:\n        for para in sh.text_frame.paragraphs:\n            for r in para.runs:\n                if r.text == '요약:':\n                    r.text = '요약'");
    assert.ok(findingsOf(gate(bare).report, "OF-118").some((f) => f.severity === "HIGH"), "a bold label running into its sentence is reported");
  });

  it("a single takeaway stays with its timeline, a chart states its unit once, and a contact-split field starts where its rows end", () => {
    const tl = oneSlide("timeline-one", "gazette", "layout: timeline\ntitle: top-rule\n\n## 4분기 이전 일정\n\n| 시점 | 일 | 상태 |\n|---|---|---|\n| 10월 2주 | 장서 이전 | 진행 |\n| 10월 4주 | 서가 배치 | 예정 |\n| 11월 2주 | 재개관 | 예정 |\n\n- 장서 이전이 끝나면 서가 배치를 바로 시작한다");
    const take = tl.page.find((s) => s.text.startsWith("장서 이전이 끝나면"));
    const labels = tl.page.filter((s) => /^(장서 이전|서가 배치|재개관)$/u.test(s.text));
    const lowest = Math.max(...labels.map((s) => s.y + s.h));
    assert.ok(take.y - lowest <= 60, `the takeaway follows the axis: label foot ${Math.round(lowest)}, takeaway ${Math.round(take.y)}`);
    const legend = oneSlide("unit-legend", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 주차별 미정리 도서\n\n::: chart type=line unit=\"권\"\n| 주차 | 계획 (권) | 실적 (권) |\n|---|---|---|\n| 8월 4주 | 300 | 300 |\n| 9월 2주 | 210 | 220 |\n| 10월 2주 | 0 | 30 |\n:::\n\n- 미정리 도서는 주마다 50권씩 줄어 11월 첫 주에 없어진다");
    assert.doesNotMatch(parts(legend.pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0], /<c:valAx>[\s\S]*<c:title>/u, "the legend carries the unit, so the axis carries no title");
    const level = oneSlide("unit-axis", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 회차별 검색 과업 성공률\n\n::: chart type=column unit=\"%\"\n| 회차 | 과업 성공률 |\n|---|---|\n| 1차 | 64 |\n| 2차 | 75 |\n| 3차 | 83 |\n:::\n\n- 3차 시험에서 83%로 목표 85%에 다가섰다");
    const axis = /<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:bodyPr rot="(-?\d+)"/u.exec(parts(level.pptx, /^ppt\/charts\/chart\d+\.xml$/u)[0]);
    assert.ok(axis && Number(axis[1]) % 21600000 === 0, `a level axis title: ${axis && axis[1]}`);
    const close = oneSlide("contact-split", "studio", "layout: closing-contact-split\n\n## 11월 분관 개관 협의 안건\n\n| 안건 | 담당 | 일정 |\n|---|---|---|\n| 서가·열람석 배치 | 예시 시설팀 | 10월 셋째 주 |\n| 초기 장서 수량 | 예시 자료팀 | 10월 말 |\n| 무인 반납기 설치 | 예시 정보팀 | 10월 말 |\n\n- 요청: 조건 세 가지를 정한다");
    const field = close.page.find((s) => s.fill && s.x > 300 && Math.round(s.x + s.w) === 960);
    assert.ok(field && field.x < 24 + 912 * 7 / 12 - 12, `the field starts where the rows end: ${JSON.stringify(field)}`);
  });
});

describe("lit-pptx line breaks", () => {
  it("a line the engine sets never breaks inside a short parenthetical such as (▲ +3.9%)", () => {
    const G = require("../skills/lit-pptx/scripts/lib/grid-resolver.js");
    for (let w = 6; w <= 16; w += 0.5) {
      for (const set of [G.keepLines("대출 1,184건으로 계획보다 44건(▲ +3.9%) 많았다", w, 12), G.keepLines("Loans beat the plan by 44 (▲ +3.9 %) this quarter", w, 12), G.balanceLines("반납 110건(▲ +10.0%)", 2, w)]) {
        for (const line of set.split("\n")) assert.ok(!/\([^)]*$/u.test(line), `a break inside a short parenthetical: ${JSON.stringify(set)}`);
      }
    }
  });
});

describe("lit-pptx worked examples", { skip: deckSkip }, () => {
  it("every example compiles under its tonality and passes the gate, deck output checks included", () => {
    const examples = `${deckRoot}/references/examples`;
    const names = readdirSync(examples).filter((name) => name.endsWith(".md")).sort();
    assert.ok(names.length >= 17, `${names.length} examples`);
    const seen = new Set();
    // Examples name neutral placeholder pictures; the test draws them, since the skill ships no images.
    const draw = spawnSync(shapesPython(), ["-c", "import sys\nfrom PIL import Image\nfor n in 'abc': Image.new('RGB', (1600, 900), (110 + 30 * 'abc'.index(n), 130, 140)).save(f'{sys.argv[1]}/example-{n}.png')", ensureDir(join(scratch, "assets"))], { encoding: "utf8", env: runtimeEnv });
    assert.equal(draw.status, 0, draw.stderr);
    const failures = [];
    for (const name of names) {
      const source = readFileSync(join(examples, name), "utf8");
      seen.add(source.match(/^tonality:\s*(\S+)/mu)?.[1]);
      const md = join(scratch, name);
      writeFileSync(md, source);
      const built = runDeck("compile", md, "--pptx", md.replace(/\.md$/u, ".pptx"));
      if (built.status !== 0) { failures.push(`${name}: compile ${built.stderr.trim().split("\n").pop()}`); continue; }
      const checked = gate(md.replace(/\.md$/u, ".pptx"));
      if (checked.status !== 0) failures.push(`${name}: ${checked.report.failure_reasons.join("; ")}`);
    }
    assert.deepEqual(failures, []);
    assert.deepEqual([...seen].sort(), ["atlas", "bauhaus", "chalk", "computational-brutalism", "gazette", "ledger", "neo-brutalism", "newsroom", "night", "paper", "riso", "signal", "studio"]);
  });
});

// ── lit-docx tonality engine ───────────────────────────────────────────────
const docRoot = "skills/lit-docx";
const docDoctor = spawnSync("python3", [`${docRoot}/run.py`, "doctor"], { encoding: "utf8", env: runtimeEnv });
const docSkip = docDoctor.status === 0 && JSON.parse(docDoctor.stdout).pythonReady ? false : "document runtime not in the LitOpenCode cache";
const soffice = spawnSync("which", ["soffice"], { encoding: "utf8" }).status === 0;

function runDoc(...args) {
  return spawnSync("python3", [join(process.cwd(), docRoot, "run.py"), ...args], { cwd: scratch, encoding: "utf8", env: runtimeEnv });
}

function convert(name, source, ...flags) {
  const md = join(scratch, `${name}.md`);
  const docx = join(scratch, `${name}.docx`);
  writeFileSync(md, source);
  const result = runDoc("md-to-docx", md, docx, ...flags);
  return { md, docx, result };
}

function docGate(docx, ...flags) {
  const result = runDoc("qa", docx, ...flags);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

function part(docx, name) {
  return spawnSync("unzip", ["-p", docx, name], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
}

const reportSource = [
  "---", "title: 물류 거점 운영 점검 보고", "subtitle: 2026년 3분기 처리량과 지연 현황", "organization: 예시 물류 운영팀", "date: 2026-10-01",
  "notice: \"예시 데이터: 실제 수치로 바꿔 주세요\"", "---", "",
  "# 요약", "", "3분기 일 처리량은 네 거점 합계 56,400건으로 2분기보다 6.2% 늘었다. 지연률은 북부 거점이 4.2%로 가장 높다.", "",
  "::: keyfigures cols=3", "- **56,400건** 일 처리량", "  - 2분기 53,100건 대비", "- **2.9%** 평균 지연률", "  - 2분기 3.1%", "- **4.2%** 북부 지연률", "  - 네 거점 중 최고", ":::", "",
  "# 거점별 현황", "", "## 처리량과 지연률", "", "<표 1> 거점별 일 처리량과 지연률", "",
  "| 거점 | 일 처리량 (건) | 지연률 (%) |", "|---|---:|---:|", "| 동부 | 18,400 | 2.1 |", "| 서부 | 15,900 | 3.4 |", "| 남부 | 12,300 | 1.8 |", "| 북부 | 9,800 | 4.2 |", "",
  "자료: 예시 물류 운영 자료(2026년 9월)", "",
  "::: callout kind=key title=\"결정 요청\"", "북부 거점 분류 설비 교체 예산 12억 원의 승인을 10월 15일까지 요청한다.", ":::", "",
  "# 개선 계획", "", "- 10월: 북부 거점 설비 진단과 교체 견적 비교", "- 11월: 교체 공사 착수 여부 결정", "- 12월: 교체 후 첫 달 지연률 측정", "",
].join("\n");

describe("lit-docx tonality engine", { skip: docSkip }, () => {
  it("loads six tonalities and refuses an unknown one and a tonality beside a publisher", () => {
    for (const name of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) {
      const { result } = convert(`six-${name}`, reportSource, "--tonality", name);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`tonality=${name}`, "u"));
    }
    const unknown = convert("unknown", reportSource, "--tonality", "Marble").result;
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stdout + unknown.stderr, /Brief.*Journal.*Manual.*Memo.*Proposal.*Report/su);
    const both = convert("both", reportSource, "--tonality", "Report", "--publisher", "elsevier").result;
    assert.notEqual(both.status, 0);
    assert.match(both.stdout + both.stderr, /mutually exclusive/u);
  });

  it("directives become Word structures within the budget, no fence reaches the page, and the gate passes", () => {
    const { md, docx, result } = convert("report", reportSource, "--tonality", "Report");
    assert.equal(result.status, 0, result.stderr);
    const xml = part(docx, "word/document.xml");
    assert.doesNotMatch(xml, /:::|keyfigures cols|kind=key/u);
    const checked = docGate(docx, "--source", md, "--tonality", "Report");
    assert.equal(checked.status, 0, JSON.stringify(checked.report.failure_reasons));
    assert.ok(checked.report.output.components.keyfigures >= 1 && checked.report.output.components.callout >= 1, JSON.stringify(checked.report.output.components));
  });

  it("a publisher run on a source with ::: components keeps the attribute quotes straight and still curls the prose quotes", () => {
    const source = [
      "---", "title: 분류 설비 교체 검토", "---", "",
      "::: callout kind=key title=\"승인 요청\"", "북부 거점 분류 설비 교체 예산의 1차 집행을 이번 주 운영 회의에서 승인해 주십시오.", ":::", "",
      "# 검토 배경", "", "네 거점 가운데 북부 거점을 \"우선 교체\" 대상으로 정했다.", "",
    ].join("\n");
    for (const publisher of ["korean-generic", "elsevier"]) {
      const { docx, result } = convert(`publisher-components-${publisher}`, source, "--publisher", publisher);
      assert.equal(result.status, 0, `${publisher}: ${result.stderr || result.stdout}`);
      const text = [...part(docx, "word/document.xml").matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((m) => m[1]).join("");
      assert.match(text, /승인 요청/u, `${publisher}: the callout title is drawn`);
      assert.doesNotMatch(text, /:::|kind=key/u, `${publisher}: no fence text reaches the page`);
      assert.match(text, /“우선 교체”/u, `${publisher}: prose quotes still curl`);
    }
  });

  it("a publisher table right-aligns its number columns, header included, and sets cells single-spaced", () => {
    const source = [
      "---", "title: Catalyst comparison", "---", "",
      "Table 1. Change against the baseline (example values)", "",
      "| Inlet temperature | Conversion change (%) | Half-conversion time (min) |", "|---|---:|---:|",
      "| 180 °C | -0.07 | 42 |", "| 200 °C | 3.4 | 31 |", "| 220 °C | 5.9 | 24 |", "",
    ].join("\n");
    for (const publisher of ["acs", "elsevier"]) {
      const { docx, result } = convert(`publisher-table-${publisher}`, source, "--publisher", publisher);
      assert.equal(result.status, 0, `${publisher}: ${result.stderr || result.stdout}`);
      const table = part(docx, "word/document.xml").match(/<w:tbl>[\s\S]*?<\/w:tbl>/u)[0];
      const rows = [...table.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/gu)].map((m) => [...m[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/gu)].map((c) => c[0]));
      for (const [ri, row] of rows.entries()) {
        for (const [ci, cell] of row.entries()) {
          const where = `${publisher} row ${ri} col ${ci}`;
          if (ci > 0) assert.match(cell, /<w:jc w:val="right"\/>/u, `${where}: a number column is right-aligned, its header too`);
          assert.match(cell, /<w:spacing (?=[^>]*w:after="0")(?=[^>]*w:line="276")/u, `${where}: no body double spacing inside a cell`);
        }
      }
    }
  });

  it("every tonality sets ink headings, booktabs tables without fills, A4 with 25 mm sides and Pretendard", () => {
    for (const name of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) {
      const docx = join(scratch, `six-${name}.docx`);
      const doc = part(docx, "word/document.xml");
      const styles = part(docx, "word/styles.xml");
      assert.match(doc, /<w:pgSz w:w="11906" w:h="1683[89]"/u, name);
      const margins = doc.match(/<w:pgMar [^>]*>/u)[0];
      for (const side of ["left", "right"]) assert.ok(Number(margins.match(new RegExp(`w:${side}="(\\d+)"`, "u"))[1]) >= 1417, `${name} ${margins}`);
      assert.match(styles, /Pretendard/u, name);
      const restraint = docGate(docx, "--tonality", name).report.output.findings.filter((f) => ["heading.ink", "table.fill", "heading.ratio", "color.accent-kinds"].includes(f.check));
      assert.deepEqual(restraint, [], name);
    }
  });

  it("two tonalities of one source differ in at least three structural features", () => {
    const pairs = [["01-report-ko", "Report", "Brief"], ["04-proposal-ko", "Proposal", "Report"], ["03-manual-ko", "Manual", "Report"], ["02-brief-ko", "Brief", "Memo"], ["07-report-en", "Report", "Journal"]];
    for (const [example, a, b] of pairs) {
      const source = readFileSync(`${docRoot}/references/examples/${example}.md`, "utf8");
      const first = convert(`pair-${example}-${a}`, source, "--tonality", a);
      const second = convert(`pair-${example}-${b}`, source, "--tonality", b);
      assert.equal(first.result.status + second.result.status, 0, first.result.stderr + second.result.stderr);
      const checked = docGate(first.docx, "--compare", second.docx, "--tonality", a);
      assert.ok(checked.report.output.structure.differ.length >= 3, `${example} ${a}/${b}: ${checked.report.output.structure.differ}`);
    }
  });

  it("the restraint checks find colour, a loud heading, a shaded cell, an ISO date and a header chip", () => {
    // The converter rewrites ISO dates in Korean text, so the ISO date is planted in the Word file.
    const { docx } = convert("loud", reportSource, "--tonality", "Report");
    const code = [
      "import sys, zipfile, re, shutil",
      "src, out = sys.argv[1], sys.argv[2]",
      "with zipfile.ZipFile(src) as z, zipfile.ZipFile(out, 'w') as w:",
      "  for i in z.infolist():",
      "    d = z.read(i.filename)",
      "    if i.filename == 'word/document.xml':",
      "      t = d.decode()",
      "      t = t.replace('일 처리량은', '2026-09-30 기준 일 처리량은', 1)",
      "      t = t.replace('<w:tc><w:tcPr>', '<w:tc><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"C8E0F4\"/>', 1)",
      "      t = re.sub(r'(w:val=\"Heading[12]\"/>.*?<w:r>)', r'\\1<w:rPr><w:color w:val=\"C0392B\"/><w:sz w:val=\"44\"/></w:rPr>', t, count=1, flags=re.S)",
      "      d = t.encode()",
      "    if i.filename.startswith('word/header'):",
      "      t = d.decode()",
      "      t = t.replace('</w:p>', '<w:r><w:rPr><w:color w:val=\"A21B12\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"FDECEA\"/></w:rPr><w:t>예시 데이터</w:t></w:r></w:p>', 1)",
      "      d = t.encode()",
      "    w.writestr(i, d)",
    ].join("\n");
    const loud = join(scratch, "loud-planted.docx");
    const planted = spawnSync("python3", ["-c", code, docx, loud], { encoding: "utf8" });
    assert.equal(planted.status, 0, planted.stderr);
    const checks = new Set(docGate(loud, "--tonality", "Report").report.output.findings.map((f) => f.check));
    for (const id of ["table.fill", "heading.ink", "heading.ratio", "date.iso", "furniture.chip"]) assert.ok(checks.has(id), `${id} in ${[...checks]}`);
  });

  // The paragraph properties of the paragraph that holds `text`, and their space before and after in twips.
  const pPrOf = (xml, text) => { const head = xml.slice(0, xml.indexOf(text)); return head.slice(Math.max(head.lastIndexOf("<w:p>"), head.lastIndexOf("<w:p "))); };
  const spaceOf = (pPr, side) => Number((new RegExp(`<w:spacing [^>]*w:${side}="(\\d+)"`, "u").exec(pPr) || [])[1] || 0);
  const memoSource = [
    "---", "title: Change to the study-room booking rules from 3 November", "author: Branch services team (example)", "organization: Example City Library",
    "date: 2026-10-01", "short_title: Study-room booking change", "notice: \"Example memo: names, dates and numbers are placeholders\"", "---", "",
    "::: cover variant=masthead kicker=\"Internal memo\"", "To: All staff at the central branch (example) · From: Branch services · Subject: study-room booking", ":::", "",
    "# What changes", "",
    "From Monday 3 November, members can no longer book a study room at the counter on the day. Every booking goes through the online calendar, up to seven days ahead, for at most two hours a day. Rooms not claimed within 15 minutes of the start return to the calendar.", "",
    "We are making this change because the eight rooms are now booked about 90 times a week, up from 40 a year ago. Members queueing at the counter for rooms have held up loans and returns on six Saturdays since July.", "",
    "::: callout kind=warning title=\"Quiet floor\"", "The third floor is a quiet floor. Do not send members there to wait for a room, even for a few minutes. Floor staff will ask waiting groups to move to the café.", ":::", "",
    "# What you need to do", "",
    "1. If a member asks for a room at the counter after 3 November, show them the calendar on the kiosk beside the entrance. The kiosk prints a booking slip with the room code.",
    "2. Tell groups of more than six people to book the seminar room on the ground floor instead of a study room.",
    "3. Release a room in the calendar when its group leaves early. The next member on the waiting list then gets a message.", "",
    "Members with a library access card keep the two accessible rooms beside the lift. Nothing changes for them.", "",
    "# Numbers behind the decision", "",
    "Table 1. Study-room use, one year apart (example data)", "",
    "| Measure (example) | Oct 2025 | Sep 2026 |", "| --- | ---: | ---: |", "| Room bookings per week | 40 | 90 |", "| Average group size | 3.1 | 2.8 |", "| Saturday counter queues reported | 0 | 6 |", "",
    "Eight rooms of two hours each cover the busiest week this year (96 bookings, of which 81 were used).", "",
    "# Questions", "",
    "Ask the branch services desk on extension 2210 (example) or reply to this memo. We will review the new arrangement at the end of January and report back to all staff.", "",
  ].join("\n");

  it("a memo that fits one page stays on it, its run-in head and the paragraph after a list set clear, and a short spill fails memo.fit", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const { md, docx, result } = convert("memo-fit", memoSource, "--tonality", "Memo");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const xml = part(docx, "word/document.xml");
    assert.ok(spaceOf(pPrOf(xml, "Quiet floor"), "before") >= 240, `space above the run-in head: ${pPrOf(xml, "Quiet floor").slice(0, 200)}`);
    assert.ok(spaceOf(pPrOf(xml, "Members with a library access card"), "before") >= 120, "the paragraph after a list stands clear of it");
    const one = docGate(docx, "--source", md, "--layout", "--tonality", "Memo").report;
    assert.ok(one.output.rendered, one.output.render);
    assert.ok(!one.output.findings.some((f) => f.check === "memo.fit"), JSON.stringify(one.output.findings.map((f) => f.check)));
    assert.equal(one.output.pages, 1, "the memo fits one page");
    // A memo that spills a few lines onto page 2 is reported.
    const spill = convert("memo-spill", `${memoSource}\nThe new rules apply to tutors who book rooms for paid lessons as well; they book through the same calendar and show their tutor card at the counter.\n\nWe will put up the new signs in the week before 3 November and take the old booking sheets off the counter on the same day.\n`, "--tonality", "Memo");
    assert.equal(spill.result.status, 0, spill.result.stderr);
    const two = docGate(spill.docx, "--source", spill.md, "--layout", "--tonality", "Memo").report;
    assert.ok(two.output.findings.some((f) => f.check === "memo.fit" && f.page === 2), JSON.stringify(two.output.findings.map((f) => f.check)));
    assert.notEqual(docGate(spill.docx, "--source", spill.md, "--layout", "--tonality", "Memo").status, 0);
  });

  it("under a publisher profile the paragraph after a table, a table caption and a figure caption stand 8 pt clear of the text", () => {
    const png = spawnSync("python3", ["-c", "import sys, zlib, struct\nw, h = 60, 30\nraw = b''.join(b'\\x00' + b'\\xff\\xff\\xff' * w for _ in range(h))\nc = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))\nopen(sys.argv[1], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b''))", join(scratch, "publisher-fig.png")], { encoding: "utf8" });
    assert.equal(png.status, 0, png.stderr);
    const source = [
      "---", "title: Adsorption on a modified carbon", "author: Example Author B", "---", "",
      "# Results", "", "The modified carbon takes up more dye than the untreated carbon at every dose.", "",
      "Table 1. Dye uptake after 30 min (example values)", "",
      "| Dose (g/L) | Untreated | Modified |", "| ---: | ---: | ---: |", "| 0.5 | 38 | 61 |", "| 1.0 | 52 | 79 |", "",
      "At both doses the modified carbon removes more dye within 30 min.", "",
      "![Figure 1. Uptake over time (synthetic)](publisher-fig.png)", "",
      "The two curves differ in shape as well as in height.", "",
    ].join("\n");
    for (const publisher of ["elsevier", "acs"]) {
      const { docx, result } = convert(`publisher-spacing-${publisher}`, source, "--publisher", publisher);
      assert.equal(result.status, 0, `${publisher}: ${result.stderr || result.stdout}`);
      const xml = part(docx, "word/document.xml");
      assert.ok(spaceOf(pPrOf(xml, "At both doses"), "before") >= 160, `${publisher}: the paragraph after the table: ${pPrOf(xml, "At both doses").slice(0, 200)}`);
      assert.ok(spaceOf(pPrOf(xml, "Dye uptake after"), "before") >= 160, `${publisher}: the table caption after text`);
      assert.ok(spaceOf(pPrOf(xml, "Uptake over time (synthetic)"), "after") >= 160, `${publisher}: the figure caption keeps 8 pt under it`);
    }
  });

  const keepNext = (pPr) => /<w:keepNext\/>/u.test(pPr);

  it("a list of up to six items keeps together with its lead-in, and a heading keeps its lead sentence with the table they open", () => {
    const source = [
      "---", "title: 무인 반납기 시범 운영 결과", "notice: \"예시 데이터: 수치는 가정입니다\"", "---", "",
      "# 결론과 다음 단계", "", "무인 반납기는 처리 시간과 창구 대기에서 기대한 효과를 냈다.", "", "다음 단계는 아래와 같다.", "",
      "1. 2026년 11월: 분관 두 곳 설치 예산 승인", "2. 2027년 1월: 휴관일에 맞춰 설치 공사", "3. 2027년 2월: 반납 분류 인력 1명 재배치", "4. 2027년 3월: 설치 효과 확인 뒤 전 분관 확대 검토", "",
      "이 보고서의 모든 수치는 예시다.", "",
      "# 설치안 비교", "", "세 설치안의 설치비와 회수 기간을 비교했다.", "", "표 1. 설치안 비교 (예시)", "",
      "| 설치안 | 설치비 (억 원) | 회수 기간 (년) |", "| --- | ---: | ---: |", "| A. 현재 창구 유지 | 0.0 | 0.0 |", "| B. 반납기 한 대 | 1.4 | 4.1 |", "",
      "자료: 예시 추정", "",
    ].join("\n");
    const { docx, result } = convert("keep-list", source, "--tonality", "Report");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const xml = part(docx, "word/document.xml");
    assert.ok(keepNext(pPrOf(xml, "다음 단계는 아래와 같다.")), "the lead-in keeps with its list");
    for (const item of ["2026년 11월", "2027년 1월", "2027년 2월"]) assert.ok(keepNext(pPrOf(xml, item)), `${item} keeps with the next item`);
    assert.ok(!keepNext(pPrOf(xml, "2027년 3월")), "the last item ends the chain");
    assert.ok(keepNext(pPrOf(xml, "세 설치안의 설치비와")), "the heading's lead sentence keeps with the table it opens");
  });

  it("the page checks find a split short list, a heading apart from its table, a near-empty second page and a lone last paragraph", () => {
    const probe = join(scratch, "pages.py");
    writeFileSync(probe, [
      "import sys, json", "sys.path.insert(0, sys.argv[1])", "import docx_layout as L",
      "frame = {'page_h': 841.9, 'top': 70.0, 'bottom': 70.0}",
      "def page(lines, bottom):",
      "    return {'h': 841.9, 'lines': lines, 'ink': [(y0, y1) for y0, y1, _ in lines] + [(70.0, bottom)], 'images': 0, 'boxes': [(72.0, y0, 300.0, y1, t) for y0, y1, t in lines], 'filled': 0.0}",
      "blocks = [{'t': 'h', 'level': 1, 'text': '다음단계', 'raw': '다음 단계'}, {'t': 'p', 'text': '아래와같이진행한다', 'list': False},",
      "          {'t': 'p', 'text': '예산을승인한다', 'list': True}, {'t': 'p', 'text': '공사를마친다', 'list': True}, {'t': 'p', 'text': '인력을배치한다', 'list': True},",
      "          {'t': 'h', 'level': 1, 'text': '설치안', 'raw': '설치안'}, {'t': 'p', 'text': '세설치안을비교했다', 'list': False},",
      "          {'t': 'tbl', 'rows': ['설치안설치비', 'A현재창구'], 'component': None, 'cells': []}]",
      "info = {'blocks': blocks, 'components': {k: 0 for k in L.KINDS}, 'cover': False, 'memo': False, 'frame': frame}",
      "p1 = page([(80, 92, '다음단계'), (100, 112, '아래와같이진행한다'), (700, 712, '예산을승인한다')], 712)",
      "p2 = page([(80, 92, '공사를마친다'), (100, 112, '인력을배치한다'), (740, 752, '설치안'), (760, 770, '세설치안을비교했다')], 770)",
      "p3 = page([(80, 90, '설치안설치비'), (95, 105, 'A현재창구')], 105)",
      "print(json.dumps(sorted({f['check'] for f in L.paged(info, [p1, p2, p3], True, {})[0]})))",
      "print(json.dumps(sorted({f['check'] for f in L.paged({**info, 'blocks': blocks[:1]}, [p1, p1, page([(80, 92, '끝')], 92)], True, {})[0]})))",
      // A heading between the lead and the table opens its own section, so the table is not this heading's.
      "budget = blocks[:2] + [{'t': 'h', 'level': 1, 'text': '예산', 'raw': '예산'}] + blocks[6:]",
      "full = page([(80, 92, '다음단계'), (100, 112, '아래와같이진행한다')] + [(130 + 20 * i, 142 + 20 * i, f'본문{i}') for i in range(30)], 742)",
      "nxt = page([(80, 92, '예산'), (100, 112, '세설치안을비교했다'), (130, 140, '설치안설치비'), (145, 155, 'A현재창구')], 155)",
      "print(json.dumps(sorted({f['check'] for f in L.paged({**info, 'blocks': budget}, [full, nxt], True, {})[0]})))",
    ].join("\n"));
    const run = spawnSync("python3", ["-B", probe, join(process.cwd(), docRoot, "scripts")], { encoding: "utf8", env: runtimeEnv });
    assert.equal(run.status, 0, run.stderr);
    const [first, second, third] = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
    for (const check of ["list.split", "heading.apart", "page.spill"]) assert.ok(first.includes(check), `${check}: ${JSON.stringify(first)}`);
    assert.ok(second.includes("page.spill"), JSON.stringify(second));
    assert.ok(!third.includes("heading.apart"), `the heading right above the table owns it: ${JSON.stringify(third)}`);
  });

  it("a source of about a page is set tight in any tonality and stays on one page; a section after a ruled box draws no second rule", { skip: soffice ? false : "soffice not on PATH" }, () => {
    // The memo trimmed to about a page (Brief sets wider than Memo).
    const brief = memoSource.replace(" Members queueing at the counter for rooms have held up loans and returns on six Saturdays since July.", "")
      .replace(" Rooms not claimed within 15 minutes of the start return to the calendar.", "").replace(" Floor staff will ask waiting groups to move to the café.", "")
      .replace(" The kiosk prints a booking slip with the room code.", "").replace(" Nothing changes for them.", "")
      .replace("3. Release a room in the calendar when its group leaves early. The next member on the waiting list then gets a message.\n", "")
      .replace(" We will review the new arrangement at the end of January and report back to all staff.", " We will review the arrangement at the end of January.");
    const { md, docx, result } = convert("brief-tight", brief, "--tonality", "Brief");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /tight spacing/u);
    assert.match(pPrOf(part(docx, "word/document.xml"), "What you need to do"), /<w:top w:val="nil"\/>/u, "no hairline over the section right under the Quiet floor box");
    const checked = docGate(docx, "--source", md, "--layout", "--tonality", "Brief").report;
    assert.ok(checked.output.rendered, checked.output.render);
    assert.ok(!checked.output.findings.some((f) => f.check === "page.spill"), JSON.stringify(checked.output.findings.map((f) => f.check)));
    assert.equal(checked.output.pages, 1);
  });

  it("a wrapping text column takes room from columns that have it, negatives take the minus sign, and an uncaptioned table stands clear of the sentence above it", () => {
    const source = [
      "---", "title: 분관별 주간 대출", "notice: \"예시 데이터: 수치는 가정입니다\"", "---", "", "# 분관별 대출", "", "분관마다 대출과 변화를 적었다.", "",
      "| Branch | Loans | Change | Share |", "| --- | ---: | ---: | ---: |", "| River Road | 1,240 | -3 | 21% |", "| North Hill Reading Room | 980 | -12 | 17% |", "| Market Square | 2,105 | 8 | 36% |", "",
      "자료: 예시 집계", "",
    ].join("\n");
    const { docx, result } = convert("columns", source, "--tonality", "Report");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const xml = part(docx, "word/document.xml");
    const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/gu)].map((m) => Number(m[1]) / 20);
    assert.ok(grid[0] >= 95, `the branch column takes room from the number columns: ${JSON.stringify(grid)}`);
    assert.match(xml, /\u22123</u, "a negative takes U+2212");
    assert.match(xml, /\u221212</u);
    assert.doesNotMatch(xml, />-3</u);
    assert.ok(spaceOf(pPrOf(xml, "분관마다 대출과 변화를 적었다."), "after") >= 120, "the sentence above an uncaptioned table keeps 6 pt under it");
  });

  it("under a publisher profile a paragraph after a list stands 6 pt clear, after a table three quarters of a line, and a short list keeps together", () => {
    const source = [
      "---", "title: A four-line loan report", "author: Example Author C", "---", "", "# Results", "", "Every branch report states four lines.", "",
      "1. Loans in the week.", "2. Items overdue.", "3. Holds waiting.", "", "Lines 2 and 3 together show the shelf pressure.", "",
      "Table 1. Overdue change (example)", "", "| Week | Change (%) |", "| ---: | ---: |", "| 38 | 1.2 |", "| 39 | -0.4 |", "",
      "The fall in week 39 follows the reminder text.", "",
    ].join("\n");
    for (const publisher of ["elsevier", "acs"]) {
      const { docx, result } = convert(`publisher-list-${publisher}`, source, "--publisher", publisher);
      assert.equal(result.status, 0, `${publisher}: ${result.stderr || result.stdout}`);
      const xml = part(docx, "word/document.xml");
      assert.ok(spaceOf(pPrOf(xml, "Lines 2 and 3"), "before") >= 120, `${publisher}: after the list ${pPrOf(xml, "Lines 2 and 3").slice(0, 200)}`);
      assert.ok(spaceOf(pPrOf(xml, "The fall in week 39"), "before") >= 180, `${publisher}: after the table ${pPrOf(xml, "The fall in week 39").slice(0, 200)}`);
      assert.ok(keepNext(pPrOf(xml, "Loans in the week")) && keepNext(pPrOf(xml, "Items overdue")), `${publisher}: a short list keeps together`);
    }
  });

  it("the gate fails a notice that joins its label and line with a spaced dash", () => {
    const body = "---\n\n# 일정\n\n다음 주 월요일부터 바뀐다.\n";
    const dashed = convert("notice-dash", `---\ntitle: 운영 메모\ntonality: Memo\nnotice: 예시 안내문 — 일정은 가정입니다\n${body}`, "--tonality", "Memo");
    assert.equal(dashed.result.status, 0, dashed.result.stderr);
    const hit = docGate(dashed.docx, "--source", dashed.md, "--tonality", "Memo").report.output.findings;
    assert.ok(hit.some((f) => f.check === "notice.dash"), JSON.stringify(hit.map((f) => f.check)));
    const colon = convert("notice-colon", `---\ntitle: 운영 메모\ntonality: Memo\nnotice: "예시 안내문: 일정은 가정입니다"\n${body}`, "--tonality", "Memo");
    assert.ok(!docGate(colon.docx, "--source", colon.md, "--tonality", "Memo").report.output.findings.some((f) => f.check === "notice.dash"));
  });

  it("in a two-column body a page-wide table spans with its source line, a five-item list may break once between its first and last two items, and the columns close with a continuous break", () => {
    const source = [
      "---", "title: Loan return times at two branch libraries", "author: Example Author A", "notice: \"Synthetic example: data are placeholders\"", "---", "",
      "# Method", "", "Each branch logged returns for four weeks.", "", "Table 1. Returns by branch and desk (example values)", "",
      "| Branch | Desk | Returns | Minutes |", "| --- | --- | ---: | ---: |", "| North | Counter | 1,240 | 3.1 |", "| Harbour | Machine | 980 | 1.2 |", "",
      "Source: synthetic data, four weeks", "",
      "## Logging", "", "Each return was timed from arrival to shelf.", "",
      "Every short branch report states five lines:", "",
      "1. Returns per opening hour.", "2. Median time to shelf.", "3. Longest queue of the week.", "4. Staff hours at the desk.", "5. Number of weeks logged.", "",
      "Lines 3 and 4 together give the desk load.", "",
    ].join("\n");
    const { docx, result } = convert("journal-columns", source, "--tonality", "Journal");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const xml = part(docx, "word/document.xml");
    const table = xml.indexOf("Returns by branch and desk");
    const resume = xml.indexOf('w:num="1"', table);
    assert.ok(table > 0 && resume > 0 && xml.indexOf(">Source: synthetic data") < resume, "the source line stands under the page-wide table, before the columns resume");
    for (const start of ["Every short branch report", "Returns per opening hour", "Staff hours at the desk"]) assert.ok(keepNext(pPrOf(xml, start)), `${start} keeps with the next paragraph`);
    for (const start of ["Median time to shelf", "Longest queue of the week"]) assert.ok(!keepNext(pPrOf(xml, start)), `the column list may break after ${start}`);
    const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/gu)];
    assert.doesNotMatch(sects.at(-1)[0], /w:num="2"/u, "the document closes on a one-column section");
    assert.match(sects.at(-2)[0], /w:num="2"/u);
    assert.ok(sects.at(-2).index > xml.indexOf("Lines 3 and 4 together"), "the column section holds the last paragraph");
    assert.match(pPrOf(xml, "Lines 3 and 4 together"), /<w:widowControl w:val="0"\/>/u, "the last paragraph may break across the balanced columns");
  });

  it("a closing section of a few lines and a short list keeps whole; one with a table does not", () => {
    const head = ["---", "title: 무인 반납기 시범 운영 결과", "notice: \"예시 데이터: 수치는 가정입니다\"", "---", "", "# 배경", "", "무인 반납기를 본관과 분관 두 곳에서 여섯 달 운영했고, 처리 시간과 창구 대기, 오류 건수를 주마다 기록해 계획과 비교했다.", ""];
    const tail = ["# 결론과 다음 단계", "", "무인 반납기는 처리 시간과 창구 대기에서 기대한 효과를 냈다. 오류가 남은 원인은 기기 자체가 아니라 바코드 부착 위치와 야간 점검에 있었고, 두 가지 모두 고칠 수 있다.", "", "다음 단계는 아래와 같다.", "",
      "1. 2026년 11월: 분관 두 곳 설치 예산 승인", "2. 2027년 1월: 설치 공사", "3. 2027년 2월: 반납 분류 인력 재배치", "", "이 보고서의 모든 수치는 예시다.", ""];
    const whole = convert("closing-whole", [...head, ...tail].join("\n"), "--tonality", "Report");
    assert.equal(whole.result.status, 0, whole.result.stderr || whole.result.stdout);
    const xml = part(whole.docx, "word/document.xml");
    assert.ok(keepNext(pPrOf(xml, "무인 반납기는 처리 시간과")), "the closing paragraph keeps with the list after it");
    assert.ok(!keepNext(pPrOf(xml, "무인 반납기를 본관과")), "an earlier section is untouched");
    const tabled = convert("closing-table", [...head, ...tail, "| 단계 | 시기 |", "| --- | --- |", "| 승인 | 11월 |", ""].join("\n"), "--tonality", "Report");
    assert.ok(!keepNext(pPrOf(part(tabled.docx, "word/document.xml"), "무인 반납기는 처리 시간과")), "a closing section with a table moves no paragraph");
  });

  it("the page checks find a heading at the foot of a column and columns that do not balance", () => {
    const probe = join(scratch, "columns.py");
    writeFileSync(probe, [
      "import sys, json", "sys.path.insert(0, sys.argv[1])", "import docx_layout as L",
      "frame = {'page_h': 841.9, 'top': 70.0, 'bottom': 70.0}",
      "def page(lines):",
      "    return {'h': 841.9, 'w': 595.3, 'lines': sorted((y0, y1, t) for _, y0, y1, t in lines), 'ink': [(y0, y1) for _, y0, y1, _ in lines], 'images': 0, 'boxes': [(x0, y0, x0 + 230.0, y1, t) for x0, y0, y1, t in lines], 'filled': 0.0}",
      "def col(x, y0, y1, tag):",
      "    return [(x, y, y + 11, f'{tag}{k}줄') for k, y in enumerate(range(int(y0), int(y1), 14))]",
      "def blocks(*items):",
      "    return [dict({'t': t, 'text': x, 'list': lst, 'cols': 2}, **({'level': 1, 'raw': x} if t == 'h' else {})) for t, x, lst in items]",
      "info = lambda b: {'blocks': b, 'components': {k: 0 for k in L.KINDS}, 'cover': False, 'memo': False, 'frame': frame}",
      "checks = lambda b, pages: json.dumps(sorted({f['check'] for f in L.paged(info(b), pages, True, {})[0]}))",
      "heads = blocks(('h', '배경', False), ('p', '왼쪽0줄', False), ('h', '방법', False), ('p', '다음0줄', False))",
      "first = page([(70, 80, 92, '배경')] + col(70, 100, 760, '왼쪽') + col(310, 80, 740, '오른쪽') + [(310, 750, 762, '방법')])",
      "print(checks(heads, [first, page(col(70, 80, 420, '다음') + col(310, 80, 410, '끝'))]))",
      "print(checks(heads[:2], [first, page(col(70, 80, 500, '다음'))]))",
      "listed = blocks(('h', '배경', False), ('p', '왼쪽0줄', False), *[('p', f'{n}항목', True) for n in '가나다라마'])",
      "p1 = page([(70, 80, 92, '배경')] + col(70, 100, 730, '왼쪽') + [(70, 740, 751, '가항목'), (70, 754, 765, '나항목')] + col(310, 80, 765, '오른쪽'))",
      "p2 = page([(70, 80, 91, '다항목'), (70, 94, 105, '라항목'), (70, 108, 119, '마항목')] + col(70, 124, 420, '다음') + col(310, 80, 420, '끝'))",
      "print(checks(listed, [p1, p2]))",
      "print(checks(listed[:2], [page([(70, 80, 92, '배경')] + col(70, 100, 520, '왼쪽') + col(310, 80, 765, '오른쪽')), p2]))",
    ].join("\n"));
    const run = spawnSync("python3", ["-B", probe, join(process.cwd(), docRoot, "scripts")], { encoding: "utf8", env: runtimeEnv });
    assert.equal(run.status, 0, run.stderr);
    const [foot, lone, even, hole] = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(foot.includes("heading.column"), JSON.stringify(foot));
    assert.ok(lone.includes("columns.balance"), JSON.stringify(lone));
    for (const check of ["columns.balance", "list.split", "heading.column"]) assert.ok(!even.includes(check), `${check}: ${JSON.stringify(even)}`);
    assert.ok(hole.includes("columns.balance"), JSON.stringify(hole));
  });

  it("every worked example converts under its tonality and passes the gate with its pages checked", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const examples = `${docRoot}/references/examples`;
    const names = readdirSync(examples).filter((name) => name.endsWith(".md")).sort();
    assert.ok(names.length >= 9, `${names.length} examples`);
    const seen = new Set();
    const failures = [];
    for (const name of names) {
      const source = readFileSync(join(examples, name), "utf8");
      seen.add(source.match(/^tonality:\s*(\S+)/mu)?.[1]?.toLowerCase());
      const { md, docx, result } = convert(`example-${name.replace(/\.md$/u, "")}`, source);
      if (result.status !== 0) { failures.push(`${name}: ${result.stderr.trim().split("\n").pop()}`); continue; }
      const checked = docGate(docx, "--source", md, "--layout");
      if (checked.status !== 0) failures.push(`${name}: ${checked.report.failure_reasons.join("; ")}`);
      else if (!checked.report.output.rendered) failures.push(`${name}: pages not rendered (${checked.report.output.render})`);
    }
    assert.deepEqual(failures, []);
    assert.deepEqual([...seen].sort(), ["brief", "journal", "manual", "memo", "proposal", "report"]);
  });
});
