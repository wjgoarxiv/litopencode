import { parseStrictJson } from "./strict-json.mjs";
import { validateEvidenceManifest } from "./evidence.mjs";
import { validateReviewReceipt } from "./review.mjs";

export function validateEvidenceManifestText(text) {
  const result = validateEvidenceManifest(parseStrictJson(text));
  if (!result.valid) throw new Error(`Invalid Evidence Manifest: ${result.errors.join("; ")}`);
  return result;
}

export function validateReviewReceiptText(text) {
  const result = validateReviewReceipt(parseStrictJson(text));
  if (!result.ok) throw new Error(`Invalid Review Receipt: ${result.errors.join("; ")}`);
  return result;
}
