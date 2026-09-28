import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyModelConfig } from "../src/cli/model-policy.ts";

const categories = ["planning", "execution", "review", "research"];

function homogeneous(model, provider = "openai", variant = "high") {
  return {
    categories: Object.fromEntries(
      categories.map((category) => [category, { provider, model, variant, textVerbosity: "medium" }])
    ),
    agents: {
      "lit-loop": { category: "execution" },
      "lit-plan": { category: "planning" }
    }
  };
}

test("classifies exact fresh, legacy, current, other GPT-5.6, and custom boundaries", () => {
  // Given: the accepted exact model-state classes and false-positive boundary.
  const cases = [
    [null, { class: "fresh", originalDispatchId: null }],
    [{ categories: { planning: { variant: "high" } } }, { class: "fresh", originalDispatchId: null }],
    [homogeneous("gpt-5.4"), { class: "managed_legacy", originalDispatchId: "openai/gpt-5.4" }],
    [homogeneous("openai/gpt-5.5", undefined), { class: "custom", originalDispatchId: "openai/gpt-5.5" }],
    [homogeneous("gpt-5.6-sol", "openai", "medium"), { class: "gpt56_other", originalDispatchId: "openai/gpt-5.6-sol" }],
    [homogeneous("gpt-5.6-terra", "openai", "xhigh"), { class: "gpt56_other", originalDispatchId: "openai/gpt-5.6-terra" }],
    [homogeneous("gpt-5.6", "openai"), { class: "gpt56_other", originalDispatchId: "openai/gpt-5.6" }],
    [homogeneous("gpt-5.6-fast", "openai"), { class: "gpt56_other", originalDispatchId: "openai/gpt-5.6-fast" }],
    [homogeneous("gpt-5.6-luna", "openai"), { class: "gpt56_managed", originalDispatchId: "openai/gpt-5.6-luna" }],
    [homogeneous("gpt-6-astra", "openai", "xhigh"), { class: "astra_managed", originalDispatchId: "openai/gpt-6-astra" }],
    [homogeneous("gpt-5.60", "openai"), { class: "custom", originalDispatchId: "openai/gpt-5.60" }],
    [homogeneous("custom-model", "custom-provider"), { class: "custom", originalDispatchId: "custom-provider/custom-model" }]
  ];

  // When/Then: each exact input maps to one preservation policy class.
  for (const [config, expected] of cases) {
    assert.deepEqual(classifyModelConfig(config), expected, JSON.stringify(config));
  }
});

test("classifies mixed and partial routes as mixed with an explicit nullable dispatch", () => {
  // Given: three shapes that must never be treated as installer-managed legacy.
  const mixedRoutes = homogeneous("gpt-5.5");
  mixedRoutes.categories.research.model = "gpt-5.4";
  const partialRoutes = homogeneous("gpt-5.5");
  delete partialRoutes.categories.research;
  // When/Then: both require preservation rather than automatic migration.
  for (const config of [mixedRoutes, partialRoutes]) {
    assert.deepEqual(classifyModelConfig(config), { class: "mixed", originalDispatchId: null });
  }
});

test("classifies agent-only and nonstandard category routes as custom preserved state", () => {
  const cases = [
    [
      { agents: { "lit-loop": { category: "execution", provider: "custom-provider", model: "agent-model" } } },
      "custom-provider/agent-model"
    ],
    [
      { categories: { custom: { provider: "custom-provider", model: "category-model", variant: "high" } } },
      "custom-provider/category-model"
    ],
    [
      { categories: { planning: { variant: "high" } }, agents: { "lit-loop": { model: "agent-alias" } } },
      "agent-alias"
    ]
  ];

  for (const [config, originalDispatchId] of cases) {
    assert.deepEqual(classifyModelConfig(config), { class: "custom", originalDispatchId });
  }
});

test("rejects extra category route overrides from the exact managed-legacy shape", () => {
  // Given: otherwise homogeneous legacy routes containing user-owned route keys.
  const overrideKeys = ["temperature", "providerOptions", "promptAppend", "maxTokens"];

  // When/Then: every override keeps its original dispatch but is never package-managed legacy.
  for (const key of overrideKeys) {
    const config = homogeneous("gpt-5.5");
    config.categories.planning[key] = key === "providerOptions" ? { custom: true } : key === "temperature" ? 0.2 : "custom";
    const result = classifyModelConfig(config);
    assert.notEqual(result.class, "managed_legacy", key);
    assert.equal(result.originalDispatchId, "openai/gpt-5.5", key);
  }
});
