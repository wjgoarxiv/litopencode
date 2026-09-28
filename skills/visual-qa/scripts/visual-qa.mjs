#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readBoundedJsonFile } from "./bounded-json.mjs";
import { readBoundedJsonStream } from "./stdin-json.mjs";
import { inspectUiArtifact } from "./artifact.mjs";
import {
  evaluateCapabilityBlocks,
  evaluateRendererOwnership,
  visualQaBlockedCodes,
  visualQaFailCodes
} from "./capabilities.mjs";
import { validateEvidenceManifestText, validateReviewReceiptText } from "./contract-text.mjs";
import {
  completionConditionsForTier,
  evaluateEvidenceFreshness,
  evaluateTierCompletion,
  validateEvidenceManifest
} from "./evidence.mjs";
import {
  canonicalEvidenceManifestBytes,
  evaluateEvidenceManifest,
  hashBytes,
  hashCanonicalValue,
  hashCaptureArtifacts
} from "./evidence-evaluate.mjs";
import { inspectPng } from "./png.mjs";
import { comparePngs, decodePng } from "./png-decode.mjs";
import {
  validateReviewIndependence,
  validateReviewReceipt
} from "./review.mjs";
import { inspectTui } from "./tui.mjs";

export {
  completionConditionsForTier,
  comparePngs,
  canonicalEvidenceManifestBytes,
  decodePng,
  evaluateCapabilityBlocks,
  evaluateEvidenceManifest,
  evaluateRendererOwnership,
  hashCanonicalValue,
  hashBytes,
  hashCaptureArtifacts,
  evaluateEvidenceFreshness,
  evaluateTierCompletion,
  inspectPng,
  inspectUiArtifact,
  inspectTui,
  validateReviewIndependence,
  validateReviewReceipt,
  validateReviewReceiptText,
  validateEvidenceManifest,
  validateEvidenceManifestText,
  visualQaBlockedCodes,
  visualQaFailCodes
};

export function readBoundedEvidenceManifestFile(filePath, options) {
  return readBoundedJsonFile(filePath, { ...options, validate: validateEvidenceManifest });
}

export function readBoundedReviewReceiptFile(filePath, options) {
  return readBoundedJsonFile(filePath, { ...options, validate: validateReviewReceipt });
}

export async function runVisualQaCli(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("Usage: node visual-qa.mjs <capabilities|ownership|freshness|tier|review|png|tui>");
  }
  const input = await readBoundedJsonStream(process.stdin);
  if (argv[0] === "capabilities") return evaluateCapabilityBlocks(input);
  if (argv[0] === "ownership") return evaluateRendererOwnership(input);
  if (argv[0] === "freshness") return evaluateEvidenceFreshness(input);
  if (argv[0] === "tier") return evaluateTierCompletion(input);
  if (argv[0] === "review") return validateReviewIndependence(input);
  if (argv[0] === "png") return inspectPng(Buffer.from(input.base64, "base64"));
  if (argv[0] === "tui") return inspectTui(input.text, input.options);
  throw new Error(`Unknown visual-QA operation: ${argv[0]}`);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runVisualQaCli()
    .then((output) => process.stdout.write(JSON.stringify(output) + "\n"))
    .catch((error) => {
      process.stderr.write(`visual-qa: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
