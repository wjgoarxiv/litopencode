#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson } from "./canonical-json.mjs";
import { argumentInvalid } from "./contract-error.mjs";
import { readBoundedJsonFile as readBoundedJson } from "./bounded-json.mjs";
import {
  designContractBeta2SchemaId,
  designContractBetaSchemaId,
  designContractSchemaId,
  validateDesignContract,
  validateDesignContractText
} from "./design-contract.mjs";
import {
  canonicalDatasetBytes,
  canonicalDatasetRecords,
  canonicalDatasetSha256,
  readCanonicalDesignIntelligence,
  validateDesignIntelligenceDataset
} from "./dataset.mjs";
import { retrieveDesignIntelligence } from "./retrieval.mjs";
import { readBoundedJsonStream } from "./stdin-json.mjs";

export {
  canonicalDatasetBytes,
  canonicalDatasetRecords,
  canonicalDatasetSha256,
  designContractBeta2SchemaId,
  designContractBetaSchemaId,
  designContractSchemaId,
  readCanonicalDesignIntelligence,
  retrieveDesignIntelligence,
  validateDesignContract,
  validateDesignContractText,
  validateDesignIntelligenceDataset
};

export function readBoundedJsonFile(filePath, options) {
  return readBoundedJson(filePath, { ...options, validate: validateDesignContract });
}

// Exit-code contract for `validate`:
//   0  the contract is valid; one line of {valid, schema, issues} JSON on stdout
//   1  the contract parsed but broke a rule; the same envelope, with populated
//      issues, on stdout
//   2  the input could not be trusted at all (oversize, non-UTF-8, duplicate
//      keys, NUL bytes, trailing data, non-regular file, unknown operation);
//      a human-readable line on stderr and nothing on stdout
// The code is always handed back for process.exitCode instead of calling
// process.exit(), so buffered stdout is flushed before the process ends.
export async function runUiuxCli(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "retrieve") {
    const request = await readBoundedJsonStream(process.stdin);
    return { exitCode: 0, stdout: canonicalJson(await retrieveDesignIntelligence(request)) };
  }
  if (argv.length === 1 && argv[0] === "validate") {
    const result = validateDesignContract(await readBoundedJsonStream(process.stdin));
    return { exitCode: result.valid ? 0 : 1, stdout: canonicalJson(result) };
  }
  throw argumentInvalid("Usage: node uiux.mjs <retrieve|validate> < input.json");
}

// Both sides are resolved because an installed skills root reaches this file
// through a symlink; comparing unresolved paths silently skips the CLI.
function isCliEntrypoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(entry).href === import.meta.url;
  }
}

if (isCliEntrypoint()) {
  runUiuxCli()
    .then(({ exitCode, stdout }) => {
      process.stdout.write(stdout);
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`uiux: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
