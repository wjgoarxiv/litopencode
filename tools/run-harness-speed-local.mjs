#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  LocalBenchmarkError,
  runPackedLocalBenchmark,
  summarizeDurations
} from "./harness-speed-local.mjs";

export { LocalBenchmarkError, runPackedLocalBenchmark, summarizeDurations };

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || argv[index + 1] === undefined) throw new LocalBenchmarkError("INVALID_CLI_USAGE");
  return argv[index + 1];
}

async function writeReceipt(filePath, receipt) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function main(argv) {
  const outputPath = option(argv, "--output");
  const receipt = await runPackedLocalBenchmark({
    arm: option(argv, "--arm"),
    artifactSha256: option(argv, "--artifact-sha256"),
    head: option(argv, "--head"),
    packageRoot: path.resolve(option(argv, "--package-root")),
    samples: Number(option(argv, "--samples")),
    scenarioPath: path.resolve(option(argv, "--scenario"))
  });
  await writeReceipt(path.resolve(outputPath), receipt);
  process.stdout.write(`${JSON.stringify({ verdict: "PASS", output: path.basename(outputPath), provider_completions: 0 })}\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof LocalBenchmarkError) {
      process.stderr.write(`${JSON.stringify({ verdict: "FAIL", code: error.code, provider_completions: 0 })}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
