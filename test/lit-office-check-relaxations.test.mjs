import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

// Direct cases for four narrowed checks: a closing References slide is the deck's source line, an
// acronym ban matches only the capitalised word, lexical diversity is read per subsection, and table
// rows and list markers are not dashes. Each runs the check's own function in the cached runtime that
// the office skills install (`run.mjs doctor`, `run.py doctor`), and skips with that reason without it.
const runtimeEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
delete runtimeEnv.TYPESAFE_API_KEY;
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "litopencode", "office");
const venvPython = (skill, prefix) => join(cache,
  `${prefix}-${createHash("sha256").update(readFileSync(`skills/${skill}/requirements.lock`)).digest("hex").slice(0, 16)}`, "bin", "python");
const deckPython = venvPython("lit-pptx", "python-pptx");
const docPython = venvPython("lit-docx", "python-docx");
const deckSkip = existsSync(deckPython) ? false : "deck runtime not in the LitOpenCode cache";
const docSkip = existsSync(docPython) ? false : "document runtime not in the LitOpenCode cache";
const scratch = mkdtempSync(join(tmpdir(), "litopencode-check-relaxations-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function runPython(python, scripts, code, input) {
  const result = spawnSync(python, ["-c", code, resolve(scripts), scratch], { input: JSON.stringify(input), encoding: "utf8", env: runtimeEnv });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Builds a two-slide deck whose last slide holds the given lines, and returns its source-line check.
const sourceNoteCode = `
import json, sys
sys.path.insert(0, sys.argv[1])
from pptx import Presentation
from pptx.util import Inches
import validate_pptx
out = {}
for name, lines in json.load(sys.stdin).items():
    prs = Presentation()
    first = prs.slides.add_slide(prs.slide_layouts[5])
    first.shapes.title.text = "Flux decline by pretreatment"
    last = prs.slides.add_slide(prs.slide_layouts[6])
    box = last.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(4))
    box.text_frame.text = "\\n".join(lines)
    target = sys.argv[2] + "/" + name + ".pptx"
    prs.save(target)
    out[name] = validate_pptx.lint(target)["checks"]["missing_source_note"]["pass"]
print(json.dumps(out))
`;

// Builds a one-slide deck carrying each text and returns whether the hard forbidden-term check passes.
const hardTermCode = `
import json, sys
sys.path.insert(0, sys.argv[1])
from pptx import Presentation
from pptx.util import Inches
import validate_pptx
out = {}
for index, text in enumerate(json.load(sys.stdin)):
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Field survey notes"
    slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(3)).text_frame.text = text
    target = sys.argv[2] + "/hard-term-" + str(index) + ".pptx"
    prs.save(target)
    out[text] = validate_pptx.lint(target)["checks"]["forbidden_terms"]["pass"]
print(json.dumps(out))
`;

const acronymCode = `
import json, sys
sys.path.insert(0, sys.argv[1])
import validate_pptx
hard, soft, case_insensitive, whole_word = validate_pptx._load_terms()
pattern = validate_pptx._build_regex(hard + soft, case_insensitive, whole_word)
print(json.dumps({"terms": [t for t in hard + soft if t in ("RAM", "FTO", "CNKI")],
                  "hits": {text: bool(pattern.search(text)) for text in json.load(sys.stdin)}}))
`;

const lintCode = `
import json, sys
sys.path.insert(0, sys.argv[1])
import slop_lint
out = {}
for name, text in json.load(sys.stdin).items():
    findings, *_ = slop_lint.lint_text(text, {}, {}, "en")
    out[name] = sorted({finding.rule_id for finding in findings})
print(json.dumps(out))
`;

describe("deck source line and acronym bans", { skip: deckSkip }, () => {
  it("a closing References or 참고 문헌 page counts as the source line; other closings do not", () => {
    const got = runPython(deckPython, "skills/lit-pptx/scripts", sourceNoteCode, {
      references: ["References", "Kim, J. (2024). Membrane fouling in seawater pretreatment."],
      korean: ["참고 문헌", "김지원 (2024). 해수 전처리의 막 오염."],
      source: ["Source: example plant log, 2026"],
      thanks: ["Thank you", "Questions welcome"],
      inline: ["References are listed in the appendix handout."]
    });
    assert.deepEqual(got, { references: true, korean: true, source: true, thanks: false, inline: false });
  });

  it("an acronym ban matches the capitalised word only, never the same letters inside another word", () => {
    const got = runPython(deckPython, "skills/lit-pptx/scripts", acronymCode, [
      "RAM budget per node", "RAM-heavy jobs", "CNKI search", "the FTO review",
      "program", "diagram", "framework", "Ram", "ram usage", "RAMS"
    ]);
    assert.deepEqual(got.terms.sort(), ["CNKI", "FTO", "RAM"]);
    assert.deepEqual(got.hits, {
      "RAM budget per node": true, "RAM-heavy jobs": true, "CNKI search": true, "the FTO review": true,
      program: false, diagram: false, framework: false, Ram: false, "ram usage": false, RAMS: false
    });
  });
  it("a one-word hard term fails as a word or its plural, never as letters inside a longer word", () => {
    const got = runPython(deckPython, "skills/lit-pptx/scripts", hardTermCode, [
      "Mastodon archive migration", "photodocument scan", "TODO: x", "Check the totals todo.", "Launch date (TBD)", "Lorem ipsum dolor",
      "Open TODOs remain", "Two placeholders left", "FIXMEs in the appendix"
    ]);
    assert.deepEqual(got, {
      "Mastodon archive migration": true, "photodocument scan": true,
      "TODO: x": false, "Check the totals todo.": false, "Launch date (TBD)": false, "Lorem ipsum dolor": false,
      "Open TODOs remain": false, "Two placeholders left": false, "FIXMEs in the appendix": false
    });
  });
});

describe("document lexical diversity and dash rule", { skip: docSkip }, () => {
  const words = (n, offset = 0) => Array.from({ length: n }, (_, i) => `term${i + offset}`).join(" ");
  const flat = (n) => Array.from({ length: n }, () => "data").join(" ");

  it("lexical diversity is read per subsection of more than 40 words and skipped when there is none", () => {
    const varied = words(45);
    const got = runPython(docPython, "skills/lit-docx/scripts", lintCode, {
      // Three subsections reuse one varied vocabulary: each reads high although the chapter repeats itself.
      perSubsection: `# Results\n\n## Plant A\n\n${varied}.\n\n## Plant B\n\n${varied}.\n\n## Plant C\n\n${varied}.\n`,
      wholeChapter: `# Results\n\n${varied}.\n\n${varied}.\n\n${varied}.\n`,
      // With its two heading words the long subsection has 41 words and is read; the short one has 40 and is not.
      flatLong: `# Results\n\n## Plant A\n\n${flat(39)}.\n`,
      flatShort: `# Results\n\n## Plant A\n\n${flat(38)}.\n`
    });
    assert.equal(got.perSubsection.includes("rule-10-lexical-diversity"), false, got.perSubsection.join(","));
    assert.equal(got.wholeChapter.includes("rule-10-lexical-diversity"), true, got.wholeChapter.join(","));
    assert.equal(got.flatLong.includes("rule-10-lexical-diversity"), true, got.flatLong.join(","));
    assert.equal(got.flatShort.includes("rule-10-lexical-diversity"), false, got.flatShort.join(","));
  });

  it("a dash in a table row or a hyphen opening a line is not a dash; a spaced hyphen in prose is", () => {
    const got = runPython(docPython, "skills/lit-docx/scripts", lintCode, {
      table: "# Results\n\n| Plant | Cleaning cycles |\n|---|---|\n| A | - |\n| B | 3 |\n",
      list: "# Results\n\n- Flux fell by a third over 500 hours\n  - basis: 2025 runs\n- Cleaning held it at the start value\n",
      prose: "# Results\n\nFlux fell by a third - and cleaning held it.\n",
      emDashes: "# Results\n\nFlux fell — sharply — after the second week.\n"
    });
    assert.deepEqual(Object.fromEntries(Object.entries(got).map(([name, rules]) => [name, rules.includes("rule-02-em-dash-cluster")])),
      { table: false, list: false, prose: true, emDashes: true });
  });
});
