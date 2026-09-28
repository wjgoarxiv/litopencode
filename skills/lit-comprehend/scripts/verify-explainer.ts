import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, basename, relative, isAbsolute } from "node:path";

type CheckResult = {
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "WARN";
  readonly detail: string;
};

type VerifierOutput = {
  readonly file: string;
  readonly checks: readonly CheckResult[];
  readonly pass: boolean;
};

const canonicalSections = [
  "한눈에",
  "이미 알고 있던 것",
  "직관",
  "바뀐 것",
  "직접 만져보기",
  "퀴즈",
  "다음"
] as const;

const externalResourcePatterns = [
  /<script[^>]+src\s*=/i,
  /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=/i,
  /<link[^>]+href\s*=[^>]*rel\s*=\s*["']stylesheet["']/i,
  /<img[^>]+src\s*=\s*["']https?:\/\//i,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bimportScripts\s*\(/,
  /<script[^>]+type\s*=\s*["']module["'][^>]+src\s*=/i,
  /@import\s+url\s*\(/i
];

const asciiBoxChars = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬]/u;
const asciiBoxPattern = /\+[-=]{3,}\+/;

function stripPreBlocks(html: string): string {
  return html.replace(/<pre[\s>][\s\S]*?<\/pre>/gi, "");
}

function stripCodeBlocks(html: string): string {
  return html.replace(/<code[\s>][\s\S]*?<\/code>/gi, "");
}

function run(artifactPath: string, repoRoot: string, jsonOutput: boolean): void {
  const checks: CheckResult[] = [];

  function check(name: string, status: "PASS" | "FAIL" | "WARN", detail: string): void {
    checks.push({ name, status, detail });
  }

  // 1. artifact-exists
  const absPath = resolve(artifactPath);
  if (!existsSync(absPath)) {
    check("artifact-exists", "FAIL", `File not found: ${absPath}`);
    output({ file: absPath, checks, pass: false }, jsonOutput);
    return;
  }
  check("artifact-exists", "PASS", "File exists");

  // 2. artifact-nonempty
  const stat = statSync(absPath);
  if (stat.size < 400) {
    check("artifact-nonempty", "FAIL", `File is ${stat.size} bytes, expected > 400`);
  } else {
    check("artifact-nonempty", "PASS", `${stat.size} bytes`);
  }

  const html = readFileSync(absPath, "utf8");

  // 3. filename-dated
  const name = basename(absPath);
  if (/^\d{4}-\d{2}-\d{2}-/.test(name)) {
    check("filename-dated", "PASS", `Filename starts with date prefix: ${name}`);
  } else {
    check("filename-dated", "FAIL", `Filename must start with YYYY-MM-DD-: ${name}`);
  }

  // 4. outside-repo
  const absRepo = resolve(repoRoot);
  const rel = relative(absRepo, absPath);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    check("outside-repo", "FAIL", `Artifact is inside the repo worktree. Write to ~/.litopencode/lit-comprehend/ instead.`);
  } else {
    check("outside-repo", "PASS", "Artifact is outside the repo worktree");
  }

  // 5. self-contained
  let hasExternal = false;
  for (const pattern of externalResourcePatterns) {
    if (pattern.test(html)) {
      hasExternal = true;
      check("self-contained", "FAIL", `External resource detected: ${pattern.source}`);
      break;
    }
  }
  if (!hasExternal) {
    check("self-contained", "PASS", "No external resource references found");
  }

  // 6. sections
  const missingSections: string[] = [];
  const optionalSections = new Set(["직접 만져보기"]);
  for (const section of canonicalSections) {
    if (!html.includes(section)) {
      if (optionalSections.has(section)) {
        check("sections", "WARN", `Optional section missing: ${section}`);
      } else {
        missingSections.push(section);
      }
    }
  }
  if (missingSections.length > 0) {
    check("sections", "FAIL", `Missing required sections: ${missingSections.join(", ")}`);
  } else {
    check("sections", "PASS", "All required canonical sections present");
  }

  // 7. quotes-real (phantom quote detection)
  const preDataSrcPattern = /<pre[^>]+data-src\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/pre>/gi;
  let quoteMatch;
  let phantomFound = false;
  while ((quoteMatch = preDataSrcPattern.exec(html)) !== null) {
    const srcAttr = quoteMatch[1];
    const quotedContent = quoteMatch[2];
    const filePath = srcAttr.replace(/:[\d-]+$/, "");
    const absFilePath = resolve(repoRoot, filePath);

    if (!existsSync(absFilePath)) {
      check("quotes-real", "FAIL", `Quoted file does not exist: ${filePath}`);
      phantomFound = true;
      continue;
    }

    const fileContent = readFileSync(absFilePath, "utf8");
    // Exclude deleted lines from hit check
    const delPattern = /<span[^>]+class\s*=\s*["'][^"']*\bdel\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi;
    const withoutDel = quotedContent.replace(delPattern, "");
    const activeLines = withoutDel
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) => line.replace(/^[+]\s?/, "").trim())
      .filter((line) => line.length > 0);

    if (activeLines.length === 0) continue;

    const hits = activeLines.filter((line) => fileContent.includes(line)).length;
    const hitRate = hits / activeLines.length;

    if (hitRate < 0.6) {
      check("quotes-real", "FAIL", `Phantom quote: ${filePath} — only ${Math.round(hitRate * 100)}% of lines found in file`);
      phantomFound = true;
    }
  }
  if (!phantomFound) {
    check("quotes-real", "PASS", "All code quotes verified against source files");
  }

  // 7b. quotes-attributed — every <pre> code block must carry data-src attribution
  const allPreBlocks = html.match(/<pre[\s>][\s\S]*?<\/pre>/gi) ?? [];
  const codePreBlocks = allPreBlocks.filter((block: string) => {
    const inner = block.replace(/<[^>]+>/g, "").trim();
    return inner.length > 0;
  });
  const attributedPreBlocks = allPreBlocks.filter((block: string) => /data-src\s*=/.test(block));
  if (codePreBlocks.length > 0 && attributedPreBlocks.length === 0) {
    check("quotes-attributed", "FAIL", `${codePreBlocks.length} code block(s) found but none carry a data-src attribution — the anti-fabrication check cannot verify unattributed quotes`);
  } else if (codePreBlocks.length === 0) {
    check("quotes-attributed", "WARN", "No code blocks found — a walkthrough of a code change normally quotes the code it explains");
  } else {
    check("quotes-attributed", "PASS", `${attributedPreBlocks.length}/${codePreBlocks.length} code block(s) carry data-src attribution`);
  }

  // 8. paths-exist
  const codePathPattern = /<code>([^<]+\.[a-z]{1,4})<\/code>/gi;
  let pathMatch;
  const knownExtensions = new Set(["ts", "tsx", "js", "mjs", "cjs", "json", "md", "html", "css", "yaml", "yml"]);
  while ((pathMatch = codePathPattern.exec(html)) !== null) {
    const candidate = pathMatch[1].trim();
    const ext = candidate.split(".").pop() ?? "";
    if (!knownExtensions.has(ext)) continue;
    if (candidate.includes("__") || candidate.startsWith("http")) continue;
    const absCandidate = resolve(repoRoot, candidate);
    if (!existsSync(absCandidate)) {
      check("paths-exist", "WARN", `Referenced path may not exist: ${candidate}`);
    }
  }

  // 9. no-ascii-art
  const outsidePre = stripPreBlocks(html);
  const outsideCode = stripCodeBlocks(outsidePre);
  if (asciiBoxChars.test(outsideCode) || asciiBoxPattern.test(outsideCode)) {
    check("no-ascii-art", "FAIL", "ASCII box-drawing characters found outside <pre> blocks. Use HTML/CSS diagrams.");
  } else {
    check("no-ascii-art", "PASS", "No ASCII box-drawing outside code blocks");
  }

  // 10. quiz
  const quizQuestions = html.match(/<[^>]+class\s*=\s*["'][^"']*\bquiz-q\b[^"']*["'][^>]*>/gi) ?? [];
  if (quizQuestions.length < 3) {
    check("quiz", "FAIL", `Only ${quizQuestions.length} quiz questions found, need at least 3`);
  } else {
    check("quiz", "PASS", `${quizQuestions.length} quiz questions found`);
  }

  // Check quiz answer attributes
  const quizQPattern = /<[^>]+class\s*=\s*["'][^"']*\bquiz-q\b[^"']*["'][^>]*data-answer\s*=\s*["']([^"']+)["']/gi;
  const answers: string[] = [];
  let qMatch;
  while ((qMatch = quizQPattern.exec(html)) !== null) {
    answers.push(qMatch[1]);
  }
  // Also try reversed attribute order
  const quizQPatternAlt = /data-answer\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*\bquiz-q\b/gi;
  while ((qMatch = quizQPatternAlt.exec(html)) !== null) {
    if (!answers.includes(qMatch[1])) answers.push(qMatch[1]);
  }

  // Check for feedback blocks per question
  const quizBlocks = html.match(/<[^>]+class\s*=\s*["'][^"']*\bquiz-q\b[\s\S]*?(?=<[^>]+class\s*=\s*["'][^"']*\bquiz-q\b|$)/gi) ?? [];
  for (let i = 0; i < quizBlocks.length; i++) {
    const block = quizBlocks[i];
    const opts = block.match(/<[^>]+class\s*=\s*["'][^"']*\bopt\b[^"']*["'][^>]*data-i\s*=\s*["']([^"']+)["']/gi) ?? [];
    const fbs = block.match(/<[^>]+class\s*=\s*["'][^"']*\bfb\b[^"']*["'][^>]*data-i\s*=\s*["']([^"']+)["']/gi) ?? [];

    if (opts.length < 3) {
      check("quiz", "FAIL", `Question ${i + 1} has fewer than 3 options`);
    }

    const optIds = new Set(opts.map((o) => {
      const m = o.match(/data-i\s*=\s*["']([^"']+)["']/);
      return m ? m[1] : "";
    }));
    const fbIds = new Set(fbs.map((f) => {
      const m = f.match(/data-i\s*=\s*["']([^"']+)["']/);
      return m ? m[1] : "";
    }));

    for (const id of optIds) {
      if (id && !fbIds.has(id)) {
        check("quiz", "FAIL", `Question ${i + 1}: option ${id} has no matching feedback block`);
      }
    }
  }

  // Positional tell: 3+ consecutive same-slot answers
  if (answers.length >= 3) {
    for (let i = 0; i <= answers.length - 3; i++) {
      if (answers[i] === answers[i + 1] && answers[i + 1] === answers[i + 2]) {
        check("quiz", "FAIL", `Positional tell: answers ${i + 1}-${i + 3} are all slot "${answers[i]}"`);
        break;
      }
    }
  }

  // Length tell warning: check if longest option is correct > 60% of the time
  if (quizBlocks.length >= 3) {
    let longestIsCorrect = 0;
    for (const block of quizBlocks) {
      const answerMatch = block.match(/data-answer\s*=\s*["']([^"']+)["']/);
      if (!answerMatch) continue;
      const correctId = answerMatch[1];
      const optPattern = /<[^>]+class\s*=\s*["'][^"']*\bopt\b[^"']*["'][^>]*data-i\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?=<[^>]+class\s*=\s*["'][^"']*\b(?:opt|fb)\b|<\/div>)/gi;
      let oMatch;
      let maxLen = 0;
      let maxId = "";
      while ((oMatch = optPattern.exec(block)) !== null) {
        const text = oMatch[2].replace(/<[^>]+>/g, "").trim();
        if (text.length > maxLen) {
          maxLen = text.length;
          maxId = oMatch[1];
        }
      }
      if (maxId === correctId) longestIsCorrect++;
    }
    if (quizBlocks.length > 0 && longestIsCorrect / quizBlocks.length > 0.6) {
      check("quiz", "WARN", `Length tell: longest option is correct in ${longestIsCorrect}/${quizBlocks.length} questions`);
    }
  }

  const hasFail = checks.some((c) => c.status === "FAIL");
  output({ file: absPath, checks, pass: !hasFail }, jsonOutput);
}

function output(result: VerifierOutput, jsonOutput: boolean): void {
  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const icon = result.pass ? "PASS" : "FAIL";
    console.log(`\n${icon}: ${result.file}\n`);
    for (const c of result.checks) {
      const sym = c.status === "PASS" ? "✓" : c.status === "WARN" ? "⚠" : "✗";
      console.log(`  ${sym} ${c.name}: ${c.detail}`);
    }
    console.log("");
  }
  process.exitCode = result.pass ? 0 : 1;
}

// CLI entry
const args = process.argv.slice(2);
let artifactPath = "";
let repoRoot = process.cwd();
let jsonFlag = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repo" && args[i + 1]) {
    repoRoot = args[++i];
  } else if (args[i] === "--json") {
    jsonFlag = true;
  } else if (!args[i].startsWith("-")) {
    artifactPath = args[i];
  }
}

if (!artifactPath) {
  console.error("Usage: node --experimental-strip-types skills/lit-comprehend/scripts/verify-explainer.ts <artifact> [--repo <dir>] [--json]");
  process.exit(1);
}

run(artifactPath, repoRoot, jsonFlag);
