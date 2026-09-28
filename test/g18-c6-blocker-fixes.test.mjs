import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { probeBrowserDriver } from "../skills/browser-drive/scripts/capability-probe.mjs";
import { validateDesignContract as validateVisualDesignContract } from "../skills/visual-qa/scripts/design-contract.mjs";
import { validBetaDesignContract } from "../test-support/uiux-visual-fixtures.mjs";

const RESOLVER_COMMAND = process.platform === "win32" ? "where.exe" : "command";

test("browser-drive requires an anchored exact agent-browser identity", () => {
  for (const banner of [
    "not-agent-browser-helper 9.9.9",
    "agent-browser-helper 9.9.9",
    "other agent-browser 9.9.9"
  ]) {
    const report = probeBrowserDriver({
      path: "/tmp/agent-browser",
      runCommand(command) {
        return command === RESOLVER_COMMAND
          ? { status: 0, stdout: "/tmp/agent-browser\n" }
          : { status: 0, stdout: `${banner}\n` };
      }
    });
    assert.equal(report.status, "unverified-identity", banner);
    assert.equal(report.blocker, "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED", banner);
  }
});

test("browser-drive rejects the wrapper spoof without exposing the reported banner", () => {
  const banner = "agent-browser wrapper 1.0";
  const report = probeBrowserDriver({
    path: "/tmp/agent-browser",
    runCommand(command) {
      return command === RESOLVER_COMMAND
        ? { status: 0, stdout: "/tmp/agent-browser\n" }
        : { status: 0, stdout: `${banner}\n` };
    }
  });
  assert.equal(report.status, "unverified-identity");
  assert.equal(report.version, null);
  assert.equal(JSON.stringify(report).includes(banner), false);
  assert.equal(report.blocker, "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED");
});

test("visual-qa validates canonical v1beta2 and explicitly retains v1beta1 compatibility", () => {
  const canonical = {
    ...validBetaDesignContract(),
    schema_id: "litfamily.design-contract/v1beta2",
    taste: { variance: 5, motion: 5, density: 5 }
  };
  const latest = validateVisualDesignContract(canonical);
  assert.equal(latest.valid, true, latest.issues.join("; "));
  assert.equal(latest.schema, "litfamily.design-contract/v1beta2");
  assert.equal(latest.evidence_eligible, true);

  const compatible = validateVisualDesignContract(validBetaDesignContract());
  assert.equal(compatible.valid, true, compatible.issues.join("; "));
  assert.equal(compatible.schema, "litfamily.design-contract/v1beta1");
  assert.equal(compatible.evidence_eligible, true);
});

test("current Design Contract documentation names v1beta2 and preserves beta1 compatibility", () => {
  const catalog = fs.readFileSync("src/uiux-visual-catalog.ts", "utf8");
  const productDirection = fs.readFileSync("skills/frontend-ui-ux/references/product-direction.md", "utf8");
  const visualSkill = fs.readFileSync("skills/visual-qa/SKILL.md", "utf8");
  const visualContract = fs.readFileSync("skills/visual-qa/references/complete-contract.md", "utf8");
  const evidenceSchema = JSON.parse(
    fs.readFileSync("skills/visual-qa/schemas/evidence-manifest-v1beta1.json", "utf8")
  );

  assert.match(catalog, /evidence-eligible v1beta2 Design Contract/u);
  assert.match(catalog, /Produce working interfaces and rendered inspection/u);
  assert.match(productDirection, /evidence-eligible `litfamily\.design-contract\/v1beta2`/u);
  assert.match(productDirection, /valid `litfamily\.design-contract\/v1beta1` documents remain accepted/u);
  assert.match(visualSkill, /canonical `litfamily\.design-contract\/v1beta2`/u);
  assert.match(visualSkill, /v1beta1` documents remain accepted/u);
  assert.match(visualContract, /canonical `litfamily\.design-contract\/v1beta2`/u);
  assert.match(visualContract, /v1beta1` documents remain accepted/u);
  assert.equal(evidenceSchema.$id, "litfamily.evidence-manifest/v1beta1");
});
