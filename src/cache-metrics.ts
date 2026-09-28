import type { Hooks } from "@opencode-ai/plugin";

/**
 * The host exposes provider usage only on the assistant message receipt. Keep this
 * shape deliberately numeric: no prompt, transcript, provider id, or model id is
 * needed to answer whether the receipt carried cache counters.
 */
export type ProviderUsageReceipt = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

export type ProviderCacheMeasurement = {
  readonly receiptEvents: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Cache-read tokens divided by the full prompt footprint. */
  readonly cacheReadShare: number | null;
};

export const emptyProviderCacheMeasurement: ProviderCacheMeasurement = Object.freeze({
  receiptEvents: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheReadShare: null
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Extract only the stable numeric receipt fields from OpenCode's
 * `message.updated` assistant event. Step-finish parts carry a second copy of
 * these counters, so they are intentionally not accepted here.
 */
export function providerUsageReceiptFromEvent(event: unknown): ProviderUsageReceipt | undefined {
  if (!isRecord(event) || event.type !== "message.updated") return undefined;
  const properties = event.properties;
  if (!isRecord(properties) || !isRecord(properties.info) || properties.info.role !== "assistant") return undefined;
  const tokens = properties.info.tokens;
  if (!isRecord(tokens) || !isRecord(tokens.cache)) return undefined;
  if (
    !nonNegativeSafeInteger(tokens.input) ||
    !nonNegativeSafeInteger(tokens.output) ||
    !nonNegativeSafeInteger(tokens.reasoning) ||
    !nonNegativeSafeInteger(tokens.cache.read) ||
    !nonNegativeSafeInteger(tokens.cache.write)
  ) return undefined;

  return Object.freeze({
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    reasoningTokens: tokens.reasoning,
    cacheReadTokens: tokens.cache.read,
    cacheWriteTokens: tokens.cache.write
  });
}

export function recordProviderUsageReceipt(
  measurement: ProviderCacheMeasurement,
  receipt: ProviderUsageReceipt
): ProviderCacheMeasurement {
  const inputTokens = measurement.inputTokens + receipt.inputTokens;
  const cacheReadTokens = measurement.cacheReadTokens + receipt.cacheReadTokens;
  const cacheWriteTokens = measurement.cacheWriteTokens + receipt.cacheWriteTokens;
  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  return Object.freeze({
    receiptEvents: measurement.receiptEvents + 1,
    inputTokens,
    outputTokens: measurement.outputTokens + receipt.outputTokens,
    reasoningTokens: measurement.reasoningTokens + receipt.reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheReadShare: Number.isSafeInteger(promptTokens) && promptTokens > 0
      ? cacheReadTokens / promptTokens
      : null
  });
}

export type ProviderUsageReceiptEventOptions = {
  readonly onReceipt: (receipt: ProviderUsageReceipt) => void | Promise<void>;
};

/** A narrow event adapter that can be composed with other OpenCode event hooks. */
export function createProviderUsageReceiptEventHook(
  options: ProviderUsageReceiptEventOptions
): NonNullable<Hooks["event"]> {
  return async ({ event }) => {
    const receipt = providerUsageReceiptFromEvent(event);
    if (receipt !== undefined) await options.onReceipt(receipt);
  };
}

export type RuleDedupMetric = {
  readonly selectedRuleCount: number;
  readonly skippedAlreadyDeliveredCount: number;
};

export function ruleDedupMetric(selectedRuleCount: number, skippedAlreadyDeliveredCount: number): RuleDedupMetric {
  const count = (value: number): number => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return Object.freeze({
    selectedRuleCount: count(selectedRuleCount),
    skippedAlreadyDeliveredCount: count(skippedAlreadyDeliveredCount)
  });
}

export type ActivationRegexMetric = {
  readonly routeMatched: boolean;
  readonly injectionAccepted: boolean;
  readonly childSession: boolean;
};

export function activationRegexMetric(
  routeMatched: boolean,
  injectionAccepted: boolean,
  childSession: boolean
): ActivationRegexMetric {
  return Object.freeze({ routeMatched, injectionAccepted, childSession });
}

export type UpdateCacheMetric = {
  readonly cacheEntryPresent: boolean;
  readonly latestVersionPresent: boolean;
  readonly noticeShown: boolean;
  readonly refreshEligible: boolean;
};

export function updateCacheMetric(
  cacheEntryPresent: boolean,
  latestVersionPresent: boolean,
  noticeShown: boolean,
  refreshEligible: boolean
): UpdateCacheMetric {
  return Object.freeze({ cacheEntryPresent, latestVersionPresent, noticeShown, refreshEligible });
}
