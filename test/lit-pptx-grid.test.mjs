import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createRequire } from "node:module";

// The slide grid, the hard-edge packs and the gate checks that guard them (OF-101, OF-113, OF-116, OF-120).
// These compile real decks through `run.mjs`, so they need the office runtime in the LitOpenCode cache;
// without it they skip with that reason, and release evidence must show them run.
const require = createRequire(import.meta.url);
const deckRoot = "skills/lit-pptx";
const runtimeEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const doctor = spawnSync(process.execPath, [`${deckRoot}/run.mjs`, "doctor"], { encoding: "utf8", env: runtimeEnv });
const readiness = doctor.status === 0 ? JSON.parse(doctor.stdout) : {};
const skip = readiness.nodeReady && readiness.pythonReady ? false : "office runtime not in the LitOpenCode cache";
const scratch = mkdtempSync(join(tmpdir(), "litopencode-grid-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const tonalities = readdirSync(join(deckRoot, "templates", "tonalities"))
  .filter((id) => existsSync(join(deckRoot, "templates", "tonalities", id, "pack.yaml"))).sort();
const fixture = (name) => join(process.cwd(), "test", "fixtures", "lit-pptx", name);

function python() {
  const lock = readFileSync(`${deckRoot}/requirements.lock`);
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "litopencode", "office");
  return join(cache, `python-pptx-${createHash("sha256").update(lock).digest("hex").slice(0, 16)}`, "bin", "python");
}

const work = () => mkdtempSync(join(scratch, "run-"));
const runDeck = (cwd, ...args) => spawnSync(process.execPath, [join(process.cwd(), deckRoot, "run.mjs"), ...args], { cwd, encoding: "utf8", env: runtimeEnv });

function compile(dir, source, name, ...flags) {
  const pptx = join(dir, `${name}.pptx`);
  const built = runDeck(dir, "compile", source, ...flags, "--pptx", pptx);
  assert.equal(built.status, 0, built.stderr + built.stdout);
  return { pptx, log: built.stdout };
}

const gateJson = (dir, pptx, extra = []) => JSON.parse(runDeck(dir, "qa", pptx, ...extra).stdout);
const findings = (report, rule) => report.craft.findings.filter((f) => f.rule === rule);

// Every shape of every slide, in points, with the fill, text, chart, table and picture flags the checks below read.
function shapesOf(pptx) {
  const probe = spawnSync(python(), ["-B", "-c", `
import json, sys
from pptx import Presentation
p = Presentation(sys.argv[1])
def fill(sh):
    try:
        return str(sh.fill.fore_color.rgb) if sh.fill.type == 1 else None
    except Exception:
        return None
out = []
for s in p.slides:
    out.append([{"name": sh.name, "x": sh.left / 12700, "y": sh.top / 12700, "w": sh.width / 12700, "h": sh.height / 12700,
                 "text": sh.text_frame.text if sh.has_text_frame else "", "fill": fill(sh),
                 "chart": bool(getattr(sh, "has_chart", False) and sh.has_chart),
                 "table": bool(getattr(sh, "has_table", False) and sh.has_table),
                 "picture": sh.shape_type == 13} for sh in s.shapes])
print(json.dumps({"slides": out, "subject": p.core_properties.subject}))
`, pptx], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  return JSON.parse(probe.stdout);
}

// Moves a shape of a compiled deck: a defect planted for the gate to find.
function plant(src, out, code) {
  const run = spawnSync(python(), ["-B", "-c", `
import sys
from pptx import Presentation
from pptx.util import Pt
p = Presentation(sys.argv[1])
${code}
p.save(sys.argv[2])
`, src, out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

// The worked examples name three neutral placeholder pictures; a test draws them beside the copy it compiles.
function exampleDeck(dir, name, flags = []) {
  const assets = join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  const draw = spawnSync(python(), ["-B", "-c", "import sys\nfrom PIL import Image\nfor i, n in enumerate('abc'): Image.new('RGB', (1600, 900), (110 + 30 * i, 130, 140)).save(f'{sys.argv[1]}/example-{n}.png')", assets], { encoding: "utf8" });
  assert.equal(draw.status, 0, draw.stderr);
  copyFileSync(join(deckRoot, "references", "examples", name), join(dir, name));
  return compile(dir, join(dir, name), name.replace(/\.md$/u, ""), ...flags).pptx;
}

// The XML of every slide, in order.
function slideXml(pptx) {
  const probe = spawnSync(python(), ["-B", "-c", `
import json, re, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\\d+\\.xml", n)), key=lambda n: int(re.findall(r"\\d+", n)[0]))
print(json.dumps([z.read(n).decode("utf8") for n in names]))
`, pptx], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(probe.status, 0, probe.stderr);
  return JSON.parse(probe.stdout);
}

// Rewrites the stamp the compiler leaves in the deck's subject, to ask the gate how another pack would judge the file.
function restamp(pptx, from, to) {
  plant(pptx, pptx, `p.core_properties.subject = p.core_properties.subject.replace(${JSON.stringify(from)}, ${JSON.stringify(to)})`);
}

// Loads packs and tonalities through the registry the way the compiler does, with extra pack folders on the path.
function registry(code, dirs = "") {
  return spawnSync(process.execPath, ["-e", `const r = require(${JSON.stringify(join(process.cwd(), deckRoot, "scripts", "lib", "template-registry.js"))});\n${code}`],
    { encoding: "utf8", env: { ...runtimeEnv, LIT_PPTX_TONALITY_DIRS: dirs } });
}

// The zones the slide grid pins, as a deck user sees them: points on the 960 x 540 page.
const ZONES = {
  cover: { title: { x: 24, y: 144, w: 678, h: 168 } },
  display: { title: { x: 24, y: 132, w: 678, h: 216 } },
  content: { title: { x: 24, y: 36, w: 756, h: 72 }, body: { x: 24, y: 120, w: 912, h: 366 }, footer: { y: 498 } },
};

describe("lit-pptx slide grid", { skip }, () => {
  it("slide-grid.js pins the zones every pack is measured against", () => {
    const grid = require(`../${deckRoot}/scripts/lib/slide-grid.js`).zones("16:9");
    assert.deepEqual(grid.content.title, { ...ZONES.content.title, a: 1, b: 10 });
    assert.deepEqual(grid.display.title, { ...ZONES.display.title, a: 1, b: 9 });
    assert.deepEqual(grid.cover.title, { ...ZONES.cover.title, a: 1, b: 9 });
    assert.deepEqual([grid.content.body.x, grid.content.body.y, grid.content.body.w, grid.content.body.h], [24, 120, 912, 366]);
    assert.equal(grid.content.footer.y, 498);
  });

  it("every tonality sets one deck's titles, headers and body on the shared slide grid: a theme changes the look, never the place", () => {
    assert.ok(tonalities.length >= 13, tonalities.join(", "));
    const near = (a, b) => Math.abs(a - b) <= 0.5;
    const same = (box, z) => near(box.x, z.x) && near(box.y, z.y) && near(box.w, z.w) && near(box.h, z.h);
    const at = (s) => `[${[s.x, s.y, s.w, s.h].map((v) => v.toFixed(1)).join(", ")}]`;
    const dir = work();
    const off = [];
    for (const id of tonalities) {
      const { pptx } = compile(dir, fixture("deck-placement.md"), id, "--tonality", id);
      shapesOf(pptx).slides.forEach((shapes, i) => {
        const title = shapes.find((s) => s.name.startsWith("title@"));
        const kind = i === 0 ? "cover" : title && /^title@(statement|section)$/u.test(title.name) ? "display" : "content";
        if (!title) { off.push(`${id} slide ${i + 1}: no title frame`); return; }
        if (!same(title, ZONES[kind].title)) off.push(`${id} slide ${i + 1} ${title.name} at ${at(title)}, the ${kind} title zone is ${at(ZONES[kind].title)}`);
        if (kind !== "content") return;
        // The body is what the slide says and the cards and fields that hold it. A device bled off the page from
        // above the body zone (a band, a rail) and a title's ornament over the body zone are not.
        const bled = (s) => s.x <= 0.5 || s.y <= 0.5 || s.x + s.w >= 959.5 || s.y + s.h >= 539.5;
        const z = ZONES.content;
        const body = shapes.filter((s) => s !== title && (s.text.trim() || s.chart || s.table || s.picture || s.fill)
          && !(bled(s) && s.y < z.body.y - 0.5)
          && !/^(lit-notice|grid-mark|header@|numeral@)/u.test(s.name) && s.y < z.footer.y - 6 && s.y + s.h > z.body.y + 0.5);
        const top = Math.min(...body.map((s) => s.y));
        const left = Math.min(...body.map((s) => s.x));
        if (!near(top, z.body.y) || !near(left, z.body.x)) off.push(`${id} slide ${i + 1}: body starts at (${left.toFixed(1)}, ${top.toFixed(1)}), the body zone at (${z.body.x}, ${z.body.y})`);
      });
    }
    assert.deepEqual(off, [], `${off.length} placement differences across ${tonalities.length} tonalities`);
  });

  it("a point written after two columns is kept under them, never dropped (comparison, text-two-column)", () => {
    const dir = work();
    const cols = ":::: columns 1fr 1fr\n::: col\n- **저녁반**\n  (1) 시간: 저녁 7시-9시\n  (2) 정원: 30명\n:::\n::: col\n- **주말반**\n  (1) 시간: 오전 10시-12시\n  (2) 정원: 20명\n:::\n::::\n\n- 두 반 모두 무료이며 재료비는 도서관이 낸다\n- 출처: 예시 운영 계획 (예시)";
    const md = join(dir, "cols.md");
    writeFileSync(md, `---\ntonality: ledger\ntitle: 열 뒤의 요점\n---\n\n---\nlayout: cover-typographic\n\n# 열 뒤의 요점\n---\n\n---\nlayout: comparison\n\n## 두 반 비교\n\n${cols}\n---\n\n---\nlayout: text-two-column\n\n## 두 반 소개\n\n${cols}\n---\n`);
    const { slides } = shapesOf(compile(dir, md, "cols").pptx);
    for (const n of [1, 2]) {
      const point = slides[n].find((sh) => sh.text.includes("두 반 모두 무료"));
      assert.ok(point, `slide ${n + 1} keeps the point`);
      const columns = slides[n].filter((sh) => /정원/u.test(sh.text));
      assert.ok(columns.length && columns.every((c) => c.y + c.h <= point.y + 1), `slide ${n + 1}: the point runs under the columns`);
    }
  });

  it("OF-101 passes four accent hue families on a slide and fails at five, with no advisory below", () => {
    const dir = work();
    const build = (fills, name) => {
      const out = join(dir, name);
      plant(join(dir, "blank.pptx"), out, `
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.util import Inches
slide = p.slides[0]
fills = ${JSON.stringify(fills)}
width = 12.3 / len(fills) - 0.2
for i, fill in enumerate(fills):
    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5 + i * (width + 0.2)), Inches(1.6), Inches(width), Inches(1.6))
    box.fill.solid()
    box.fill.fore_color.rgb = RGBColor.from_string(fill)
    box.line.fill.background()`);
      return gateJson(dir, out);
    };
    const md = join(dir, "blank.md");
    writeFileSync(md, "---\ntonality: ledger\ntitle: Blank\n---\n\n---\nlayout: cover-typographic\n\n# Blank\n---\n");
    compile(dir, md, "blank");
    const four = build(["C64D2E", "1D6B68", "C48A1C", "2B5FA6"], "four.pptx");
    assert.deepEqual(findings(four, "OF-101"), [], "four hue families are a rich slide, not a defect");
    const five = build(["C64D2E", "1D6B68", "C48A1C", "2B5FA6", "8E3B8E"], "five.pptx");
    assert.deepEqual(findings(five, "OF-101").map((f) => f.severity), ["HIGH"], "five hue families fail");
  });

  it("a hard-edged pack writes its offset shadows with no blur, keeps its KPI cards, and the gate allows them there only (OF-120)", () => {
    const dir = work();
    const file = exampleDeck(dir, "14-launch-pitch-neo-brutalism-ko.md");
    const xml = slideXml(file);
    const shadows = xml.flatMap((x) => [...x.matchAll(/<a:outerShdw\b[^>]*>/gu)].map((m) => m[0]));
    assert.ok(shadows.length >= 4, `${shadows.length} shadows`);
    for (const shadow of shadows) assert.match(shadow, /\bblurRad="0"/u, shadow);
    const kpi = shapesOf(file).slides.findIndex((shapes) => shapes.some((sh) => sh.name === "family@kpi-row"));
    assert.ok((xml[kpi].match(/<a:outerShdw\b/gu) || []).length >= 4, "four shadowed KPI cards");
    const own = gateJson(dir, file);
    assert.deepEqual(findings(own, "OF-120"), []);
    assert.deepEqual(findings(own, "OF-101"), []);
    // The same file under a pack without the allowance: the shadows fail, and its hue families still pass (OF-101 fails at five).
    restamp(file, "tonality=neo-brutalism", "tonality=signal");
    const other = gateJson(dir, file);
    assert.ok(findings(other, "OF-120").some((f) => f.severity === "HIGH" && /hard offset shadow in a pack that does not draw one/u.test(f.value)), JSON.stringify(findings(other, "OF-120")));
    assert.deepEqual(findings(other, "OF-101"), []);
  });

  it("a mono pack sets Hangul in Pretendard, marks the grid as page chrome, and installs the faces it embeds for the renderer", () => {
    const dir = work();
    const file = exampleDeck(dir, "13-engineering-review-computational-brutalism-ko.md");
    const embedded = runDeck(dir, "embed", file);
    assert.equal(embedded.status, 0, embedded.stderr + embedded.stdout);
    const xml = slideXml(file);
    const mono = xml.flatMap((x) => [...x.matchAll(/<a:latin typeface="JetBrains Mono"[^>]*\/>(<a:ea [^>]*\/>)?/gu)]);
    assert.ok(mono.length > 0);
    for (const m of mono) assert.match(m[1] || "", /typeface="Pretendard"/u, m[0]);
    assert.doesNotMatch(xml.join(""), /<a:ea typeface="JetBrains Mono"/u);
    const slides = shapesOf(file).slides;
    const kinds = slides.map((shapes) => (shapes.find((sh) => sh.name.startsWith("family@")) || {}).name);
    const marked = slides.map((shapes) => shapes.some((sh) => sh.name === "grid-mark index"));
    assert.equal(marked[kinds.indexOf("family@kpi-row")], true);
    assert.equal(marked[kinds.indexOf("family@statement")], false, "a drenched statement goes without grid marks");
    assert.equal(marked[0], false, "the cover goes without grid marks");
    // LibreOffice ignores embedded font parts; the render helper puts the plain files in its private profile.
    const placed = spawnSync(python(), ["-B", "-c", `
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import render_pages
print("\\n".join(sorted(p.name for p in render_pages.profile_fonts(Path(sys.argv[2]), Path(sys.argv[3])))))
`, join(process.cwd(), deckRoot, "scripts"), file, join(dir, "profile")], { encoding: "utf8" });
    assert.equal(placed.status, 0, placed.stderr);
    const names = placed.stdout.trim().split("\n");
    assert.ok(names.length >= 2 && names.every((n) => /\.(ttf|otf)$/u.test(n)), placed.stdout);
    for (const n of names) assert.ok(existsSync(join(dir, "profile", "user", "fonts", n)), n);
  });

  it("the mono face is the unmodified official JetBrains Mono 2.304 Regular and Bold, with its licence beside it", () => {
    const dir = join(deckRoot, "fonts", "jetbrains-mono");
    const sha = (file) => createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
    assert.equal(sha("JetBrainsMono-Regular.ttf"), "a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f");
    assert.equal(sha("JetBrainsMono-Bold.ttf"), "5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb");
    assert.equal(sha("OFL.txt"), "30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad");
    assert.match(readFileSync(join(dir, "SOURCE.md"), "utf8"), /2\.304/u);
  });

  it("refuses a hard edge, a shadow, a qa allowance or grid marks out of their bounds, and a mono body", () => {
    const dir = work();
    const neo = readFileSync(join(deckRoot, "templates", "tonalities", "neo-brutalism", "pack.yaml"), "utf8");
    const mono = readFileSync(join(deckRoot, "templates", "tonalities", "computational-brutalism", "pack.yaml"), "utf8");
    const planted = (id, source, from, edit) => {
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(join(dir, id, "pack.yaml"), edit(source.replace(`id: ${from}`, `id: ${id}`)));
    };
    planted("heavy-edge", neo, "neo-brutalism", (t) => t.replace(/^edge-weight: .*$/mu, "edge-weight: 6"));
    planted("far-shadow", neo, "neo-brutalism", (t) => t.replace(/^ {2}offset: 6$/mu, "  offset: 14"));
    planted("pink-shadow", neo, "neo-brutalism", (t) => t.replace(/^ {2}colour: ink$/mu, "  colour: hotpink"));
    planted("flat-shadow", neo, "neo-brutalism", (t) => t.replace(/^edge: .*$/mu, "edge: fill"));
    planted("loose-qa", neo, "neo-brutalism", (t) => t.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  contrast: 2"));
    planted("wide-qa", neo, "neo-brutalism", (t) => t.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  accent-families: 9"));
    // A pack may only widen the accent limit (default: five families fail); a narrower one is out of range.
    planted("narrow-qa", neo, "neo-brutalism", (t) => t.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  accent-families: 3"));
    planted("no-shadow", neo, "neo-brutalism", (t) => t.replace(/^shadow:\n {2}offset: 6\n {2}colour: ink\n/mu, ""));
    planted("banded-marks", mono, "computational-brutalism", (t) => t.replace(/^treatments: \[top-rule, /mu, "treatments: [band, top-rule, "));
    planted("mono-body", mono, "computational-brutalism", (t) => t.replace(/^ {2}body: Pretendard Regular$/mu, "  body: JetBrains Mono Regular"));
    // Presented type belongs to a bold register; a report pack (no register) keeps reading type.
    planted("loud-report", neo, "neo-brutalism", (t) => t.replace(/^register: bold\n/mu, ""));
    planted("odd-register", neo, "neo-brutalism", (t) => t.replace(/^register: bold$/mu, "register: shouty"));
    const load = (id) => registry(`try { r.loadPack(${JSON.stringify(id)}); console.log("loaded"); } catch (e) { console.log(e.message); }`, dir).stdout;
    assert.match(load("heavy-edge"), /edge-weight must be 0\.5-4 pt/u);
    assert.match(load("far-shadow"), /shadow\.offset must be 3-10 pt/u);
    assert.match(load("pink-shadow"), /shadow\.colour must name a palette role/u);
    assert.match(load("flat-shadow"), /a shadow needs a bordered edge/u);
    assert.match(load("loose-qa"), /unknown qa allowance "contrast"/u);
    assert.match(load("wide-qa"), /qa\.accent-families is out of range/u);
    assert.match(load("narrow-qa"), /qa\.accent-families is out of range/u);
    assert.match(load("no-shadow"), /qa\.offset-shadow needs a shadow/u);
    assert.match(load("banded-marks"), /grid-marks needs the top margin on the ground/u);
    assert.match(load("mono-body"), /faces\.body must be a face that sets Hangul/u);
    assert.match(load("loud-report"), /presented type needs register: bold/u);
    assert.match(load("odd-register"), /register must be report or bold/u);
  });

  it("takes extra decoration kinds and the calm hero opt-out from the deck's front matter", () => {
    const run = registry(`const base = r.loadTonality("paper").pack;
const more = r.loadTonality("paper", { decoration: "numeral, column-hairlines" }).pack;
const calm = r.loadTonality("paper", { hero: "false" }).pack;
const tryLoad = (id, decoration) => { try { r.loadTonality(id, { decoration }); return "loaded"; } catch (e) { return e.message; } };
console.log(JSON.stringify({ base: base.decoration, more: more.decoration, hero: [base.hero, calm.hero], unknown: tryLoad("paper", "sparkles"), marks: tryLoad("ledger", "grid-marks") }));`);
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.ok(!out.base.includes("numeral"), "paper does not draw a numeral by itself");
    assert.deepEqual(out.more, [...new Set([...out.base, "numeral", "column-hairlines"])], "front matter adds to the pack's own list");
    assert.deepEqual(out.hero, [true, false], "hero: false is the calm opt-out");
    assert.match(out.unknown, /decoration "sparkles" is not a known kind/u);
    assert.match(out.marks, /grid-marks needs the top margin on the ground/u);
  });

  it("each of the five hard-edge and editorial directions is enrolled everywhere a user or the package touches it", () => {
    const ids = ["computational-brutalism", "neo-brutalism", "bauhaus", "riso", "newsroom"];
    const manifest = JSON.parse(readFileSync("skills/managed-skill-manifest.json", "utf8")).skills["lit-pptx"].canonicalFiles.map((f) => f.path);
    const text = (rel) => readFileSync(join(deckRoot, rel), "utf8");
    const skill = text("SKILL.md");
    const examples = readdirSync(join(deckRoot, "references", "examples"));
    const missing = [];
    for (const id of ids) {
      const example = examples.find((name) => new RegExp(`-${id}-ko\\.md$`, "u").test(name));
      const checks = {
        "pack": existsSync(join(deckRoot, "templates", "tonalities", id, "pack.yaml")),
        "sheet": text(`references/tonalities/${id}.md`).length > 3000 && /When to use/u.test(text(`references/tonalities/${id}.md`)) && /wrong choice|Wrong choice|wrong if/u.test(text(`references/tonalities/${id}.md`)),
        "example": Boolean(example) && new RegExp(`^tonality:\\s*${id}$`, "mu").test(text(`references/examples/${example}`)),
        "manifest pack": manifest.includes(`templates/tonalities/${id}/pack.yaml`),
        "manifest sheet": manifest.includes(`references/tonalities/${id}.md`),
        "manifest example": Boolean(example) && manifest.includes(`references/examples/${example}`),
        "SKILL.md table row": skill.includes(`references/tonalities/${id}.md`),
        "SKILL.md names it": skill.includes(`\`${id}\``),
        "direction step": text("references/direction-step.md").includes(id),
        "layout families": text("references/layout-families.md").includes(id),
        "title treatments": text("references/title-treatments.md").includes(id)
      };
      for (const [what, ok] of Object.entries(checks)) if (!ok) missing.push(`${id}: ${what}`);
    }
    assert.deepEqual(missing, []);
    const mono = manifest.filter((f) => f.startsWith("fonts/jetbrains-mono/"));
    assert.deepEqual(mono.sort(), ["fonts/jetbrains-mono/JetBrainsMono-Bold.ttf", "fonts/jetbrains-mono/JetBrainsMono-Regular.ttf", "fonts/jetbrains-mono/OFL.txt", "fonts/jetbrains-mono/SOURCE.md"]);
    assert.ok(manifest.includes("scripts/render_pages.py"), "the render helper installs with the skill");
    assert.match(readFileSync(join(deckRoot, "run.mjs"), "utf8"), /render:\s*\["python", "scripts\/render_pages\.py"\]/u);
  });

  it("the render command writes a PDF and page images with the embedded faces installed, or says the visual check did not run", { skip: spawnSync("which", ["soffice"]).status === 0 ? false : "soffice is not installed" }, () => {
    const dir = work();
    const file = exampleDeck(dir, "13-engineering-review-computational-brutalism-ko.md");
    assert.equal(runDeck(dir, "embed", file).status, 0);
    const out = join(dir, "pages");
    const rendered = runDeck(dir, "render", file, "--out-dir", out, "--pages", "2", "--json");
    assert.equal(rendered.status, 0, rendered.stderr + rendered.stdout);
    const report = JSON.parse(rendered.stdout);
    assert.equal(report.status, "rendered");
    assert.ok(existsSync(report.pdf));
    if (spawnSync("which", ["pdftoppm"]).status === 0) assert.deepEqual(report.pages.map((p) => p.split("/").pop()), ["page-01.png", "page-02.png"]);
  });
});
