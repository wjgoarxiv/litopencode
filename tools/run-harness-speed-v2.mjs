#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HarnessSpeedV2ContractError,
  validateV2Comparison,
  validateV2FixtureBytes
} from "../qa/harness-speed-v2-contract.mjs";

function main(argv) {
  if (argv.length !== 4 || argv[0] !== "--self-check" || argv[2] !== "--fixture") {
    throw new HarnessSpeedV2ContractError("INVALID_CLI_USAGE");
  }
  validateV2FixtureBytes(readFileSync(argv[3]));
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(argv[1], "utf8"));
  } catch {
    throw new HarnessSpeedV2ContractError("MALFORMED_RECEIPT");
  }
  process.stdout.write(`${JSON.stringify(validateV2Comparison(receipt))}\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HarnessSpeedV2ContractError) {
      process.stderr.write(`${JSON.stringify({ verdict: "FAIL", code: error.code, field: error.field })}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
