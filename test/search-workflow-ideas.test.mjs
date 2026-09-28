import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findLitOpenCodeSearchWorkflowIdea,
  litOpenCodeSearchWorkflowIdeas
} from "../src/index.ts";

const forbiddenPublicStrings = [
  "circumvent access controls",
  "circumvent paywalls",
  "solve captchas",
  "private networks allowed"
];

function flattenText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

test("search workflow ideas expose brand-clean public-source retrieval guidance", () => {
  assert.ok(litOpenCodeSearchWorkflowIdeas.length >= 5);
  const ids = litOpenCodeSearchWorkflowIdeas.map((idea) => idea.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("public-route-fallback"));
  assert.ok(ids.includes("access-verdicts"));
  assert.ok(ids.includes("ssrf-boundary"));
  assert.ok(ids.includes("fetch-attempt-verdict-schema"));
  assert.ok(ids.includes("claim-graph"));

  const text = flattenText(litOpenCodeSearchWorkflowIdeas);
  for (const token of forbiddenPublicStrings) {
    assert.doesNotMatch(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("search workflow ideas require evidence and safe boundaries", () => {
  const fallback = findLitOpenCodeSearchWorkflowIdea("public-route-fallback");
  assert.equal(fallback?.title, "Public Route Fallback");
  assert.match(flattenText(fallback), /official endpoint/i);
  assert.match(flattenText(fallback), /feed/i);
  assert.match(flattenText(fallback), /browser-rendered public/i);

  const verdicts = findLitOpenCodeSearchWorkflowIdea("access-verdicts");
  assert.match(flattenText(verdicts), /authentication required/i);
  assert.match(flattenText(verdicts), /rate limited/i);
  assert.match(flattenText(verdicts), /route coverage incomplete/i);
  assert.match(flattenText(verdicts), /HTTP 200/i);
  assert.match(flattenText(verdicts), /positive proof/i);

  const ssrf = findLitOpenCodeSearchWorkflowIdea("ssrf-boundary");
  assert.match(flattenText(ssrf), /loopback/i);
  assert.match(flattenText(ssrf), /private network/i);
  assert.match(flattenText(ssrf), /redirect/i);
  const claimGraph = findLitOpenCodeSearchWorkflowIdea("claim-graph");
  assert.match(flattenText(claimGraph), /confidence/i);
  assert.match(flattenText(claimGraph), /uncertainty/i);
  assert.match(flattenText(claimGraph), /evidence pointer/i);
  const schema = findLitOpenCodeSearchWorkflowIdea("fetch-attempt-verdict-schema");
  assert.match(flattenText(schema), /FetchAttempt/i);
  assert.match(flattenText(schema), /FetchVerdict/i);
  assert.match(flattenText(schema), /untried safe routes/i);
  assert.match(flattenText(schema), /browser-rendered public inspection is guidance only/i);
  assert.equal(findLitOpenCodeSearchWorkflowIdea("missing"), undefined);
});
