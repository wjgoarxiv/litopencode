import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activationRegexMetric,
  createProviderUsageReceiptEventHook,
  emptyProviderCacheMeasurement,
  providerUsageReceiptFromEvent,
  recordProviderUsageReceipt,
  ruleDedupMetric,
  updateCacheMetric
} from "../src/cache-metrics.ts";

function assistantReceipt(overrides = {}) {
  return {
    type: "message.updated",
    properties: {
      info: {
        id: "message-private-fixture",
        role: "assistant",
        tokens: {
          input: 100,
          output: 20,
          reasoning: 5,
          cache: { read: 80, write: 10 }
        },
        ...overrides
      }
    }
  };
}

test("extracts only numeric provider cache fields from assistant receipts", () => {
  const receipt = providerUsageReceiptFromEvent(assistantReceipt());
  assert.deepEqual(receipt, {
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 5,
    cacheReadTokens: 80,
    cacheWriteTokens: 10
  });
  assert.deepEqual(Object.keys(receipt), [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cacheReadTokens",
    "cacheWriteTokens"
  ]);
});

test("does not infer provider cache usage from non-receipts or malformed values", () => {
  assert.equal(providerUsageReceiptFromEvent({
    type: "message.part.updated",
    properties: { part: { type: "step-finish", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 1, write: 0 } } } }
  }), undefined);
  assert.equal(providerUsageReceiptFromEvent(assistantReceipt({ role: "user" })), undefined);
  assert.equal(providerUsageReceiptFromEvent(assistantReceipt({
    tokens: { input: 1.5, output: 1, reasoning: 0, cache: { read: 1, write: 0 } }
  })), undefined);
  assert.equal(providerUsageReceiptFromEvent(assistantReceipt({
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: -1, write: 0 } }
  })), undefined);
  assert.equal(providerUsageReceiptFromEvent(assistantReceipt({
    tokens: { input: 1, output: 1, reasoning: 0 }
  })), undefined);
});

test("provider measurement sums receipt events without retaining content", () => {
  const first = providerUsageReceiptFromEvent(assistantReceipt());
  const second = providerUsageReceiptFromEvent(assistantReceipt({
    id: "message-private-fixture-2",
    tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } }
  }));
  const measurement = recordProviderUsageReceipt(
    recordProviderUsageReceipt(emptyProviderCacheMeasurement, first),
    second
  );
  assert.deepEqual(measurement, {
    receiptEvents: 2,
    inputTokens: 102,
    outputTokens: 23,
    reasoningTokens: 9,
    cacheReadTokens: 85,
    cacheWriteTokens: 16,
    cacheReadShare: 85 / 203
  });
});

test("reports no cache-read share for an empty prompt footprint", () => {
  const measurement = recordProviderUsageReceipt(emptyProviderCacheMeasurement, {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0
  });
  assert.equal(measurement.cacheReadShare, null);
});

test("provider receipt event adapter ignores unrelated events and forwards numeric receipt", async () => {
  const receipts = [];
  const hook = createProviderUsageReceiptEventHook({ onReceipt: (receipt) => receipts.push(receipt) });
  await hook({ event: { type: "session.idle", properties: {} } });
  await hook({ event: assistantReceipt() });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].cacheReadTokens, 80);
});

test("secondary metrics retain their honest boundaries", () => {
  assert.deepEqual(ruleDedupMetric(2, 3), {
    selectedRuleCount: 2,
    skippedAlreadyDeliveredCount: 3
  });
  assert.deepEqual(ruleDedupMetric(-1, Number.NaN), {
    selectedRuleCount: 0,
    skippedAlreadyDeliveredCount: 0
  });
  assert.deepEqual(activationRegexMetric(true, false, true), {
    routeMatched: true,
    injectionAccepted: false,
    childSession: true
  });

  assert.deepEqual(updateCacheMetric(true, true, true, false), {
    cacheEntryPresent: true,
    latestVersionPresent: true,
    noticeShown: true,
    refreshEligible: false
  });
  assert.deepEqual(updateCacheMetric(false, false, false, true), {
    cacheEntryPresent: false,
    latestVersionPresent: false,
    noticeShown: false,
    refreshEligible: true
  });
});
