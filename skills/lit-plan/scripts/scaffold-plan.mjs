#!/usr/bin/env node
// Optional file-backed plan helper for operators outside the denied lit-plan route.
//
// Chat plans do not need this helper. When an operator chooses a file-backed draft, this script emits
// and checks the same machine-checkable TODO and final-verification row grammar used in chat.
//
//   node scripts/scaffold-plan.mjs <slug> --draft-only        write the draft, never the artifact
//   node scripts/scaffold-plan.mjs <slug> --objective "..."   seed the objective line
//   node scripts/scaffold-plan.mjs --check <file>             structural self-check, exit 1 on failure
//
// Draft root is the product state directory (.litopencode/plans). The reviewed artifact belongs in
// plans/, and this script never writes there: promotion is a human decision.
//
// Resume-safe: an existing draft is never overwritten. Re-running reports the existing path and
// exits 0, so a replayed step cannot destroy work in progress.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const draftRoot = path.join(".litopencode", "plans");
const artifactRoot = "plans";

// Only column-zero rows in the two exact handoff sections are active grammar. Fenced, nested, and
// incidental checkboxes are excluded so examples and surrounding notes cannot become work items.
const implementationRow = /^- \[([ xX])\] (\d+)\. (.*?) — Action: (.*?); Output: (.*?); Verification: (.*?)\s*$/u;
const finalVerifierRow = /^- \[([ xX])\] F(\d+)\. (.*?) — Verification: (.*?)\s*$/u;
const columnZeroCheckboxCandidate = /^- \[[^\]\r\n]*\]/u;
const angleBracketMarker = /<[^<>]*>/u;
const namedPlaceholderField = /^(?:TBD|TODO)$/iu;
const ellipsisOnlyField = /^(?:\.{3,}|…+)$/u;

function validateConcreteField(value, name, lineNumber, failures) {
  const trimmed = value.trim();
  if (
    trimmed === "" ||
    angleBracketMarker.test(trimmed) ||
    namedPlaceholderField.test(trimmed) ||
    ellipsisOnlyField.test(trimmed)
  ) {
    failures.push(`line ${lineNumber}: ${name} must be concrete and non-placeholder`);
  }
}

function usage(message) {
  console.error(message);
  console.error("usage: scaffold-plan.mjs <slug> [--draft-only] [--objective <text>]");
  console.error("       scaffold-plan.mjs --check <file>");
  return 2;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function template(slug, objective) {
  return `# Plan: ${slug}

## Objective

${objective}

## Non-goals

- (state what this plan will deliberately not do)

## Grounded facts

- (file paths, commands, and observed state this plan rests on)

## Gated unknowns

| Unknown | Who or what resolves it | Evidence required | Branch if unresolved |
| --- | --- | --- | --- |
| (none yet) | | | |

Rows use the machine-checkable grammar. Implementation rows are numbered; final-verifier rows are
F-numbered and run after every implementation row is checked. Both start at column zero.

## TODOs

- [ ] 1. <title> — Action: <action>; Output: <output>; Verification: <verification>

## Final verification

- [ ] F1. <title> — Verification: <verification>

## DoneClaim

(the falsifiable claim a reviewer can check without asking what completion means)
`;
}

export function checkPlanStructure(text) {
  const lines = text.split("\n");
  const failures = [];
  const implementation = [];
  const finalVerifier = [];
  const todosHeadings = [];
  const finalHeadings = [];
  let activeImplementationRows = 0;
  let activeFinalVerifierRows = 0;
  let openFence;
  let activeH2;

  for (const [index, line] of lines.entries()) {
    const fenceRun = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (openFence === undefined && fenceRun !== null) {
      openFence = { marker: fenceRun[1][0], length: fenceRun[1].length };
      continue;
    }
    if (
      openFence !== undefined &&
      fenceRun !== null &&
      fenceRun[1][0] === openFence.marker &&
      fenceRun[1].length >= openFence.length &&
      /^\s*$/u.test(fenceRun[2])
    ) {
      openFence = undefined;
      continue;
    }
    const lineNumber = index + 1;
    if (openFence !== undefined) continue;
    if (/^##(?:\s|$)/u.test(line)) activeH2 = line;
    if (line === "## TODOs") todosHeadings.push(lineNumber);
    if (line === "## Final verification") finalHeadings.push(lineNumber);
    if (!columnZeroCheckboxCandidate.test(line)) continue;

    if (activeH2 === "## TODOs") {
      const match = implementationRow.exec(line);
      if (match === null) {
        failures.push(`line ${lineNumber}: active TODO row must match "- [ ] N. title — Action: action; Output: output; Verification: verification"`);
        continue;
      }
      implementation.push({ number: Number(match[2]), lineNumber });
      if (match[1] === " ") activeImplementationRows += 1;
      validateConcreteField(match[3], "implementation title", lineNumber, failures);
      validateConcreteField(match[4], "Action", lineNumber, failures);
      validateConcreteField(match[5], "Output", lineNumber, failures);
      validateConcreteField(match[6], "Verification", lineNumber, failures);
      continue;
    }

    if (activeH2 === "## Final verification") {
      const match = finalVerifierRow.exec(line);
      if (match === null) {
        failures.push(`line ${lineNumber}: active final-verification row must match "- [ ] F<number>. title — Verification: verification"`);
        continue;
      }
      finalVerifier.push({ number: Number(match[2]), lineNumber });
      if (match[1] === " ") activeFinalVerifierRows += 1;
      validateConcreteField(match[3], "final-verification title", lineNumber, failures);
      validateConcreteField(match[4], "Verification", lineNumber, failures);
      continue;
    }
  }

  if (activeImplementationRows === 0) failures.push("no active unchecked implementation rows found under \"## TODOs\"");
  if (activeFinalVerifierRows === 0) failures.push("no active unchecked final-verifier (F) rows found under \"## Final verification\"");
  if (todosHeadings.length !== 1) failures.push(`expected exactly one column-zero "## TODOs" heading; found ${todosHeadings.length}`);
  if (finalHeadings.length !== 1) failures.push(`expected exactly one column-zero "## Final verification" heading; found ${finalHeadings.length}`);

  const todosHeading = todosHeadings[0];
  const finalHeading = finalHeadings[0];
  if (todosHeading !== undefined && finalHeading !== undefined && finalHeading < todosHeading) {
    failures.push(`line ${finalHeading}: final verification heading must follow the TODOs heading`);
  }
  for (const row of implementation) {
    if (todosHeading !== undefined && finalHeading !== undefined && (row.lineNumber < todosHeading || row.lineNumber > finalHeading)) {
      failures.push(`line ${row.lineNumber}: implementation rows must be under "## TODOs" and before final verification`);
    }
  }
  for (const row of finalVerifier) {
    if (finalHeading !== undefined && row.lineNumber < finalHeading) {
      failures.push(`line ${row.lineNumber}: final-verifier rows must be under "## Final verification"`);
    }
  }

  for (const [position, row] of implementation.entries()) {
    if (row.number !== position + 1) {
      failures.push(`line ${row.lineNumber}: implementation rows must be numbered consecutively from 1 (expected ${position + 1}, found ${row.number})`);
    }
  }
  for (const [position, row] of finalVerifier.entries()) {
    if (row.number !== position + 1) {
      failures.push(`line ${row.lineNumber}: final-verifier rows must be numbered consecutively from F1 (expected F${position + 1}, found F${row.number})`);
    }
  }

  const lastImplementation = implementation.at(-1);
  const firstFinal = finalVerifier[0];
  if (lastImplementation !== undefined && firstFinal !== undefined && firstFinal.lineNumber < lastImplementation.lineNumber) {
    failures.push(`line ${firstFinal.lineNumber}: final-verifier rows must follow every implementation row`);
  }

  return {
    ok: failures.length === 0,
    failures,
    implementationRows: implementation.length,
    finalVerifierRows: finalVerifier.length
  };
}

async function runCheck(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    console.error(`cannot read ${file}: ${error.message}`);
    return 2;
  }
  const result = checkPlanStructure(text);
  console.log(`plan structure: ${result.implementationRows} implementation row(s), ${result.finalVerifierRows} final-verifier row(s)`);
  if (result.ok) {
    console.log("PASS: row grammar is well-formed.");
    return 0;
  }
  console.error(`BLOCKED: ${result.failures.length} structural failure(s) before handoff.`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  return 1;
}

async function runScaffold(rawSlug, options) {
  const slug = slugify(rawSlug);
  if (slug === "") return usage("slug must contain at least one alphanumeric character");

  const draftFile = path.join(draftRoot, `${slug}.md`);
  const existing = await fs.readFile(draftFile, "utf8").catch(() => undefined);
  if (existing !== undefined) {
    // Resume-safe by construction: a replayed scaffold step must not destroy a draft in progress.
    console.log(`draft already exists, left untouched: ${draftFile}`);
    console.log(`reviewed artifact destination (promote by hand): ${path.join(artifactRoot, `${slug}.md`)}`);
    return 0;
  }

  await fs.mkdir(draftRoot, { recursive: true });
  await fs.writeFile(draftFile, template(slug, options.objective ?? "(one bounded objective in product terms)"), "utf8");
  console.log(`draft written: ${draftFile}`);
  console.log(`reviewed artifact destination (promote by hand): ${path.join(artifactRoot, `${slug}.md`)}`);
  if (!options.draftOnly) {
    console.log("note: --draft-only was not passed, but this script never writes the reviewed artifact.");
    console.log("      Promotion into plans/ stays a human decision.");
  }
  return 0;
}

async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return usage("scaffold-plan requires a slug");

  const checkIndex = argv.indexOf("--check");
  if (checkIndex !== -1) {
    const file = argv[checkIndex + 1];
    if (file === undefined) return usage("--check requires a file path");
    return await runCheck(file);
  }

  const options = { draftOnly: argv.includes("--draft-only") };
  const objectiveIndex = argv.indexOf("--objective");
  if (objectiveIndex !== -1) {
    const value = argv[objectiveIndex + 1];
    if (value === undefined) return usage("--objective requires a value");
    options.objective = value;
  }

  const slug = argv.find((entry, index) => !entry.startsWith("--") && argv[index - 1] !== "--objective");
  if (slug === undefined) return usage("scaffold-plan requires a slug");
  return await runScaffold(slug, options);
}

process.exitCode = await main(process.argv.slice(2));
