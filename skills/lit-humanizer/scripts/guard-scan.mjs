#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRules, scanText } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const maxInputBytes = 8 * 1024 * 1024;

try {
  const input = readFileSync(0);
  if (input.length > maxInputBytes) throw new Error("guard input limit exceeded");
  const request = JSON.parse(input.toString("utf8"));
  if (typeof request.file !== "string" || typeof request.oldText !== "string" || typeof request.newText !== "string") {
    throw new Error("guard input must contain file, oldText, and newText strings");
  }
  const rules = parseRules(readFileSync(join(here, "../rules.json"), "utf8"));
  const oldFindings = scanText(request.oldText, rules, request.file);
  const remaining = new Map();
  for (const finding of oldFindings) {
    const key = JSON.stringify([finding.rule, finding.severity, finding.excerpt]);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const findings = scanText(request.newText, rules, request.file).filter((finding) => {
    const key = JSON.stringify([finding.rule, finding.severity, finding.excerpt]);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
    return false;
  });
  process.stdout.write(`${JSON.stringify({ findings })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
