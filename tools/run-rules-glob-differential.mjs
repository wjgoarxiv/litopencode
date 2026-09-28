#!/usr/bin/env node
// Differential harness: LitOpenCode's hand-rolled glob matcher vs real picomatch.
//
// The engine ships dependency-free, so divergence from the dialect rule authors expect is a real
// risk. A written divergence list is a claim; this is a measurement. Every pattern in the corpus is
// compiled through both matchers against every path, and disagreements are reported.
//
// picomatch is a repo-local DEV-TIME import only. It is never imported by src/. A standalone
// checkout receives it through this package's devDependencies, so the comparison does not depend
// on a sibling repository or an environment-specific fallback.
//
//   node tools/run-rules-glob-differential.mjs            report divergences
//   node tools/run-rules-glob-differential.mjs --check    exit 1 if an UNPINNED divergence appears
//
// Pinned divergences are deliberate, documented subset choices. An unpinned one is a defect.

import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");

function loadPicomatch() {
  const source = require.resolve("picomatch");
  const version = require("picomatch/package.json").version;
  return { picomatch: require("picomatch"), source, version };
}

// Patterns a .cursor/rules or .github/instructions author actually writes, plus the edge cases
// where a hand-rolled translation is most likely to drift.
const patterns = [
  "*.ts", "*.md", "src/*.ts", "src/**", "src/**/*.ts", "**/*.ts", "**/test/**",
  "src/**/test/*.ts", "a?.md", "a??.md", "src/[abc].ts", "src/[!abc].ts", "src/[a-z].ts",
  "{a,b}.md", "src/{a,b}/*.ts", "src/{a,{b,c}}/*.ts", "docs/**/*.{md,mdx}",
  "src/index.ts", "src/", "/src/*.ts", "./src/*.ts", "**", "*", "**/*",
  "src/**/", "a*.md", "*.config.*", ".github/**/*.yml", "packages/*/src/**/*.ts"
];

const paths = [
  "a.ts", "a.md", "ab.md", "abc.md", "src/a.ts", "src/b.ts", "src/index.ts",
  "src/nested/a.ts", "src/deep/nested/a.ts", "src", "src/a", "src/test/a.ts",
  "src/a/test/b.ts", "test/a.ts", "docs/a.md", "docs/nested/a.mdx", "a.md.bak",
  "src/A.ts", "src/1.ts", "b.md", "c.md", "src/a/x.ts", "src/b/x.ts", "src/c/x.ts",
  ".github/workflows/ci.yml", "packages/one/src/deep/a.ts", "a.config.js", "src/.hidden.ts"
];

// Divergences that are deliberate subset choices, keyed `pattern :: path`. Each carries the reason
// it is accepted rather than fixed.
// Measured with picomatch({ dot: true }).
//
// `bash: true` was tried first and rejected on evidence: it compiles `*` to `.*?` instead of `[^/]*?`,
// so `*.ts` starts matching `src/a.ts` and every nested path. Rule authors scoping `*.ts` mean files
// at that level, not the whole tree, so bash mode is the wrong baseline for path scoping. `dot: true`
// is kept because rule files legitimately scope dotfiles such as `.github/**`.
const picomatchOptions = { dot: true };

const divergenceReasons = new Map([
  [
    "[!seq] negation",
    "picomatch 4.0.5 does NOT read `[!abc]` as negation under any option set tried, including " +
      "{bash:true,dot:true}: it compiles to `(?:\\[!abc\\]|[!abc])`, a literal-or-class, so `src/a.ts` MATCHES " +
      "`src/[!abc].ts`. This engine reads `!` as negation, matching gitignore, minimatch, and what a rule " +
      "author writing `.cursor/rules` means. Deliberate dialect choice; flip translateCharacterClass to " +
      "drop the `!` branch if picomatch parity is ever wanted instead."
  ],
  [
    "trailing-slash subtree",
    "`src/` is normalized to the `src` subtree, matching gitignore and how rule files scope directories. " +
      "picomatch treats the trailing slash literally and matches nothing."
  ],
  [
    "leading-slash anchor",
    "`/src/*.ts` is normalized to a repository-root anchor, matching gitignore. picomatch treats the " +
      "leading slash as a literal path segment and matches nothing."
  ]
]);

const trailingSlashPaths = [
  "src/a.ts", "src/b.ts", "src/index.ts", "src/nested/a.ts", "src/deep/nested/a.ts",
  "src", "src/a", "src/test/a.ts", "src/a/test/b.ts", "src/A.ts", "src/1.ts",
  "src/a/x.ts", "src/b/x.ts", "src/c/x.ts", "src/.hidden.ts"
];

const pinnedDivergenceTuples = [
  { pattern: "src/[!abc].ts", path: "src/a.ts", mine: false, theirs: true },
  { pattern: "src/[!abc].ts", path: "src/b.ts", mine: false, theirs: true },
  { pattern: "src/[!abc].ts", path: "src/A.ts", mine: true, theirs: false },
  { pattern: "src/[!abc].ts", path: "src/1.ts", mine: true, theirs: false },
  ...["src/", "src/**/"].flatMap((pattern) =>
    trailingSlashPaths.map((candidatePath) => ({ pattern, path: candidatePath, mine: true, theirs: false }))
  ),
  ...["src/a.ts", "src/b.ts", "src/index.ts", "src/A.ts", "src/1.ts", "src/.hidden.ts"].map((candidatePath) => ({
    pattern: "/src/*.ts",
    path: candidatePath,
    mine: true,
    theirs: false
  }))
];

function divergencePairKey(entry) {
  return `${entry.pattern}\u0000${entry.path}`;
}

function evaluateDivergencePins(actual, pins = pinnedDivergenceTuples) {
  const expectedByPair = new Map(pins.map((entry) => [divergencePairKey(entry), entry]));
  const seenPairs = new Set();
  const unpinned = [];
  const directionMismatches = [];
  for (const entry of actual) {
    const pair = divergencePairKey(entry);
    const expected = expectedByPair.get(pair);
    if (expected === undefined) {
      unpinned.push(entry);
      continue;
    }
    seenPairs.add(pair);
    if (entry.mine !== expected.mine || entry.theirs !== expected.theirs) {
      directionMismatches.push({ actual: entry, expected });
    }
  }
  const stalePins = pins.filter((entry) => !seenPairs.has(divergencePairKey(entry)));
  return { unpinned, stalePins, directionMismatches };
}

// Divergences are keyed by class rather than by pair, because one dialect decision produces many
// pairs and pinning each pair would hide a later regression inside an accepted list.
function divergenceClass(pattern) {
  if (/\[!/u.test(pattern)) return "[!seq] negation";
  if (pattern.trim().endsWith("/")) return "trailing-slash subtree";
  if (pattern.trim().startsWith("/")) return "leading-slash anchor";
  return undefined;
}

function main() {
  const loaded = loadPicomatch();
  return import(pathToFileURL(path.join(repoRoot, "dist", "rules", "glob.js")).href).then((engine) => {
    const { picomatch, source, version } = loaded;
    const divergences = [];
    let comparisons = 0;

    for (const pattern of patterns) {
      let isMatch;
      try {
        isMatch = picomatch(pattern, picomatchOptions);
      } catch (error) {
        console.error(`picomatch could not compile ${pattern}: ${error.message}`);
        continue;
      }
      for (const candidatePath of paths) {
        comparisons += 1;
        const mine = engine.matchGlob(pattern, candidatePath);
        const theirs = isMatch(candidatePath);
        if (mine !== theirs) {
          divergences.push({
            pattern,
            path: candidatePath,
            mine,
            theirs,
            cls: divergenceClass(pattern),
            key: `${pattern} :: ${candidatePath}`
          });
        }
      }
    }

    console.log(`rules-glob differential: picomatch ${version}`);
    console.log(`  source:  ${source}`);
    console.log(`  options: ${JSON.stringify(picomatchOptions)}`);
    console.log(`  ${patterns.length} patterns x ${paths.length} paths = ${comparisons} comparisons`);
    console.log(`  divergences: ${divergences.length}`);
    console.log("");

    const { unpinned, stalePins, directionMismatches } = evaluateDivergencePins(divergences);
    const seenClasses = new Set(divergences.map((entry) => entry.cls).filter((cls) => cls !== undefined));

    for (const cls of seenClasses) {
      const members = divergences.filter((entry) => entry.cls === cls);
      console.log(`  PINNED CLASS  ${cls}  (${members.length} pair(s))`);
      console.log(`    reason: ${divergenceReasons.get(cls)}`);
      for (const entry of members.slice(0, 4)) {
        console.log(`      ${entry.key}  litopencode=${entry.mine} picomatch=${entry.theirs}`);
      }
      if (members.length > 4) console.log(`      ... and ${members.length - 4} more in the same class`);
      console.log("");
    }
    for (const entry of unpinned) {
      console.log(`  UNPINNED  ${entry.key}  litopencode=${entry.mine} picomatch=${entry.theirs}`);
    }
    for (const entry of stalePins) {
      console.log(`  STALE PIN  ${entry.pattern} :: ${entry.path}  litopencode=${entry.mine} picomatch=${entry.theirs}`);
    }
    for (const mismatch of directionMismatches) {
      console.log(
        `  DIRECTION MISMATCH  ${mismatch.actual.pattern} :: ${mismatch.actual.path}  ` +
        `expected litopencode=${mismatch.expected.mine} picomatch=${mismatch.expected.theirs}, ` +
        `observed litopencode=${mismatch.actual.mine} picomatch=${mismatch.actual.theirs}`
      );
    }

    console.log("");
    if (unpinned.length === 0 && stalePins.length === 0 && directionMismatches.length === 0) {
      console.log(`rules-glob differential OK: ${divergences.length} exact pinned divergence(s), 0 unpinned, 0 stale, 0 direction mismatches.`);
      process.exit(0);
    }
    console.error(
      `rules-glob differential FAILED: ${unpinned.length} unpinned, ${stalePins.length} stale, ` +
      `${directionMismatches.length} direction mismatch(es).`
    );
    process.exit(1);
  });
}

if (process.argv.includes("--self-test")) {
  const pins = [
    { pattern: "a", path: "one", mine: true, theirs: false },
    { pattern: "c", path: "three", mine: false, theirs: true }
  ];
  const actual = [
    { pattern: "a", path: "one", mine: false, theirs: true },
    { pattern: "b", path: "two", mine: true, theirs: false }
  ];
  const result = evaluateDivergencePins(actual, pins);
  if (result.unpinned.length !== 1 || result.stalePins.length !== 1 || result.directionMismatches.length !== 1) {
    console.error("pin self-test FAILED");
    process.exit(1);
  }
  console.log("pin self-test OK: unpinned=1 stale=1 direction-mismatch=1");
} else {
  await main();
}
