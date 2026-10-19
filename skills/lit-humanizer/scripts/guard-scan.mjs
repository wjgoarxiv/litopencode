#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { negationClusterFindings, parseRules, scanText } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const maxInputBytes = 8 * 1024 * 1024;
// The host refuses worker output over its byte cap and then allows the write, so blocks go first and the list is bounded.
const maxFindings = 1000;

try {
  const input = readFileSync(0);
  if (input.length > maxInputBytes) throw new Error("guard input limit exceeded");
  const request = JSON.parse(input.toString("utf8"));
  if (typeof request.file !== "string" || typeof request.oldText !== "string" || typeof request.newText !== "string") {
    throw new Error("guard input must contain file, oldText, and newText strings");
  }
  const rules = parseRules(readFileSync(join(here, "../rules.json"), "utf8"));
  const scan = (text) => [...scanText(text, rules, request.file), ...negationClusterFindings(text, request.file)];
  // A document-scope finding is keyed by its occurrence lines, so an edit between two old occurrences does not re-raise it.
  const keyOf = (finding) => JSON.stringify([finding.rule, finding.severity, finding.occurrences ?? finding.excerpt]);
  const oldFindings = scan(request.oldText);
  const remaining = new Map();
  for (const finding of oldFindings) {
    const key = keyOf(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const findings = scan(request.newText).filter((finding) => {
    const key = keyOf(finding);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
    return false;
  });
  const ordered = [...findings.filter((finding) => finding.severity === "block"), ...findings.filter((finding) => finding.severity !== "block")];
  process.stdout.write(`${JSON.stringify({ findings: ordered.slice(0, maxFindings) })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
