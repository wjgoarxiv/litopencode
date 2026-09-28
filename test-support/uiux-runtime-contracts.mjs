import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { validDesignContract } from "./uiux-visual-fixtures.mjs";

function betaDesignContract() {
  return {
    ...validDesignContract(),
    schema_id: "litfamily.design-contract/v1beta1",
    lane: "brownfield",
    tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "primary action" }],
    component_behaviors: [{
      component_id: "component:submit-button",
      state_ids: ["state:apply-loading", "state:apply-error"],
      interaction_ids: ["interaction:submit-application"],
      keyboard_behavior: "Enter submits the focused application"
    }],
    responsive_transformations: [{
      route_id: "route:apply",
      viewport_id: "viewport:compact",
      behavior: "Form actions span the compact content width"
    }],
    motion: {
      policy: "functional",
      reduced_motion_behavior: "State changes without translation",
      transitions: [{
        id: "transition:submit",
        interaction_id: "interaction:submit-application",
        duration_ms: 160,
        easing: "ease-out"
      }]
    },
    acceptance_criteria: [{
      id: "criterion:submit",
      observable: "Keyboard submission reaches loading or error state",
      verification: "browser",
      required: true,
      inventory_ids: ["component:submit-button", "interaction:submit-application", "state:apply-loading"]
    }]
  };
}

async function assertCapabilityFile(filePath, capabilityId) {
  try {
    const stat = await fs.stat(filePath);
    assert.equal(stat.isFile(), true, `${capabilityId}: expected a file at ${filePath}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      assert.fail(`${capabilityId}: missing capability file ${filePath}`);
    }
    throw error;
  }
}

async function importCapabilityModule(filePath, capabilityId) {
  await assertCapabilityFile(filePath, capabilityId);
  return await import(pathToFileURL(path.resolve(filePath)).href);
}

export function registerUiuxRuntimeContracts({ litOpenCodeFeatures, litOpenCodeRuntimeSkills }) {
  test("uiux.design-contract-v1alpha1", async () => {
    assert.ok(
      litOpenCodeRuntimeSkills.some((skill) => skill.id === "frontend-ui-ux"),
      "uiux.design-contract-v1alpha1: frontend-ui-ux must be a native-installed runtime skill"
    );
    assert.ok(
      litOpenCodeFeatures.some((feature) => feature.id === "frontend-ui-ux"),
      "uiux.design-contract-v1alpha1: frontend-ui-ux must be organically enrolled in the feature catalog"
    );

    const schemaPath = "skills/frontend-ui-ux/schemas/design-contract-v1alpha1.json";
    await assertCapabilityFile(schemaPath, "uiux.design-contract-v1alpha1");
    const schemaText = await fs.readFile(schemaPath, "utf8");
    const schema = JSON.parse(schemaText);
    assert.equal(schema.$id, "litfamily.design-contract/v1alpha1");
    // The contract is dataset-free: integrity travels through the top-level
    // source_hash and each reference sha256, never through a corpus identity.
    for (const field of [
      "schema_id",
      "contract_id",
      "source_hash",
      "intent",
      "direction",
      "inventory",
      "accessibility",
      "localization",
      "performance",
      "evidence_policy",
      "omissions",
      "accepted_exceptions"
    ]) {
      assert.ok(schema.required.includes(field), `Design Contract must require ${field}`);
    }
    assert.equal(schema.required.length, 12, "Design Contract must require exactly twelve root keys");
    assert.equal(
      /dataset|corpus|record_count/i.test(schemaText),
      false,
      "Design Contract must not reintroduce a dataset obligation"
    );
    for (const field of [
      "routes",
      "regions",
      "components",
      "interactions",
      "states",
      "viewports",
      "references",
      "authenticated_surfaces"
    ]) {
      assert.ok(schema.properties.inventory.required.includes(field), `Inventory must require ${field}`);
    }
    for (const field of ["id", "reason", "owner"]) {
      assert.ok(schema.$defs.deviation.required.includes(field), `deviations must require ${field}`);
    }

    const module = await importCapabilityModule("skills/frontend-ui-ux/scripts/uiux.mjs", "uiux.design-contract-v1alpha1");
    assert.equal(typeof module.validateDesignContract, "function");
    assert.equal(typeof module.validateDesignContractText, "function");
    assert.equal(typeof module.readBoundedJsonFile, "function");
    assert.equal(module.designContractSchemaId, schema.$id);
    assert.deepEqual(module.validateDesignContract(validDesignContract()).valid, true);
    assert.deepEqual(module.validateDesignContract(validDesignContract()), {
      valid: true,
      schema: "litfamily.design-contract/v1alpha1",
      issues: [],
      diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
      evidence_eligible: false
    });
    // A parsed contract answers an envelope instead of throwing, so a foreign
    // schema id has to surface as a reported issue.
    const foreignSchema = module.validateDesignContract({
      ...validDesignContract(),
      schema_id: "litfamily.design-contract/v1alpha2"
    });
    assert.equal(foreignSchema.valid, false);
    assert.equal(foreignSchema.schema, schema.$id);
    assert.match(foreignSchema.issues.join("; "), /exact|schema|v1alpha1/i);
    // Bytes that cannot be trusted at all still fail earlier, in the parser.
    assert.throws(
      () => module.validateDesignContractText('{"schema_id":"litfamily.design-contract/v1alpha1","schema_id":"duplicate"}'),
      /duplicate key/i
    );

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-contract-input-"));
    try {
      const validPath = path.join(root, "contract.json");
      const invalidUtf8Path = path.join(root, "invalid-utf8.json");
      const oversizedPath = path.join(root, "oversized.json");
      const symlinkPath = path.join(root, "contract-link.json");
      await fs.writeFile(validPath, JSON.stringify(validDesignContract()), "utf8");
      await fs.writeFile(invalidUtf8Path, Buffer.from([0xc3, 0x28]));
      await fs.writeFile(oversizedPath, Buffer.alloc(1025 * 1024, 0x20));
      await fs.symlink(validPath, symlinkPath);
      assert.deepEqual((await module.readBoundedJsonFile(validPath, { authorizedRoot: root, maxBytes: 1024 * 1024 })).valid, true);
      await assert.rejects(
        async () => await module.readBoundedJsonFile(path.join(root, "..", path.basename(root), "contract.json"), {
          authorizedRoot: path.join(root, "nested"),
          maxBytes: 1024 * 1024
        }),
        /authorized root|outside/i
      );
      await assert.rejects(
        async () => await module.readBoundedJsonFile(symlinkPath, { authorizedRoot: root, maxBytes: 1024 * 1024 }),
        /symlink/i
      );
      await assert.rejects(
        async () => await module.readBoundedJsonFile(invalidUtf8Path, { authorizedRoot: root, maxBytes: 1024 * 1024 }),
        /UTF-8/i
      );
      await assert.rejects(
        async () => await module.readBoundedJsonFile(oversizedPath, { authorizedRoot: root, maxBytes: 1024 * 1024 }),
        /size|bytes|large/i
      );
      await assert.rejects(
        async () => await module.readBoundedJsonFile("/dev/null", { authorizedRoot: "/dev", maxBytes: 1024 }),
        /regular file|device/i
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("uiux.design-contract-v1beta1 validates executable behavior fields", async () => {
    const schemaPath = "skills/frontend-ui-ux/schemas/design-contract-v1beta1.json";
    await assertCapabilityFile(schemaPath, "uiux.design-contract-v1beta1");
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    assert.equal(schema.$id, "litfamily.design-contract/v1beta1");
    for (const field of ["lane", "tokens", "component_behaviors", "responsive_transformations", "motion", "acceptance_criteria"]) {
      assert.ok(schema.required.includes(field), `beta schema must require ${field}`);
    }
    const module = await importCapabilityModule("skills/frontend-ui-ux/scripts/uiux.mjs", "uiux.design-contract-v1beta1");
    assert.deepEqual(module.validateDesignContract(betaDesignContract()), {
      valid: true,
      schema: "litfamily.design-contract/v1beta1",
      issues: [],
      diagnostics: [],
      evidence_eligible: true
    });
    const dangling = betaDesignContract();
    dangling.component_behaviors[0].component_id = "component:missing";
    assert.match(module.validateDesignContract(dangling).issues.join("\n"), /component:missing.*declared component/i);
  });

  test("uiux.retrieval-deterministic", async () => {
    const module = await importCapabilityModule(
      "skills/frontend-ui-ux/scripts/uiux.mjs",
      "uiux.retrieval-deterministic"
    );
    assert.equal(typeof module.retrieveDesignIntelligence, "function");

    const request = Object.freeze({
      query: "accessible CJK dashboard navigation",
      domains: ["components", "typography"],
      limit: 20
    });
    const first = await module.retrieveDesignIntelligence(request);
    const second = await module.retrieveDesignIntelligence(request);
    const firstJson = JSON.stringify(first);

    assert.equal(JSON.stringify(second), firstJson, "normalized queries must return byte-identical canonical JSON");
    assert.ok(Buffer.byteLength(firstJson, "utf8") <= 256 * 1024, "retrieval output must be at most 256 KiB");
    assert.ok(Array.isArray(first.records), "retrieval output must expose a finite records array");
    for (const domain of request.domains) {
      assert.ok(first.records.filter((record) => record.domain === domain).length <= 20);
    }
    await assert.rejects(
      async () => await module.retrieveDesignIntelligence({ query: "x", domains: ["unknown-domain"] }),
      /unknown domain/i
    );

    const utf8BoundaryQuery = "가".repeat(1365) + "a";
    assert.equal(Buffer.byteLength(utf8BoundaryQuery, "utf8"), 4096);
    await assert.doesNotReject(
      async () => await module.retrieveDesignIntelligence({ query: utf8BoundaryQuery, domains: ["components"] })
    );
    await assert.rejects(
      async () =>
        await module.retrieveDesignIntelligence({
          query: utf8BoundaryQuery + "a",
          domains: ["components"]
        }),
      /4 KiB|4096|query.*large/i
    );

    const empty = await module.retrieveDesignIntelligence({
      query: "zzzz-no-match-7e5afae9c9d44661",
      domains: ["components"]
    });
    assert.deepEqual(empty.records, [], "empty matches must not receive fabricated fallback records");
    assert.equal(empty.total, 0);
    assert.notEqual(empty.fallbackApplied, true);
    assert.notEqual(empty.fabricated, true);

    assert.equal(typeof module.validateDesignIntelligenceDataset, "function");
    await assert.rejects(
      async () => await module.validateDesignIntelligenceDataset({ data: '{"records":[', expectedSha256: undefined }),
      /malformed|json|dataset/i
    );
    await assert.rejects(
      async () =>
        await module.validateDesignIntelligenceDataset({
          data: '{"records":[]}',
          expectedSha256: `sha256:${"0".repeat(64)}`
        }),
      /corrupt|hash|integrity|checksum/i
    );
  });

  test("uiux.no-network-no-write", async () => {
    const scriptPath = path.resolve("skills/frontend-ui-ux/scripts/uiux.mjs");
    await assertCapabilityFile(scriptPath, "uiux.no-network-no-write");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-uiux-side-effects-"));
    try {
      const probePath = path.join(dir, "deny-side-effects.mjs");
      await fs.writeFile(
        probePath,
        [
          'import childProcess from "node:child_process";',
          'import dgram from "node:dgram"; import fs from "node:fs"; import fsPromises from "node:fs/promises";',
          'import http from "node:http"; import https from "node:https"; import net from "node:net"; import tls from "node:tls";',
          'import { syncBuiltinESMExports } from "node:module";',
          'const blocked = () => { throw new Error("SIDE_EFFECT_ATTEMPT"); };',
          'for (const name of ["appendFile","chmod","chown","copyFile","cp","link","mkdir","rename","rm","rmdir","symlink","truncate","unlink","writeFile"]) { fs[name] = blocked; fsPromises[name] = blocked; }',
          'for (const [target,names] of [[http,["get","request"]],[https,["get","request"]],[net,["connect","createConnection"]],[tls,["connect"]],[dgram,["createSocket"]],[childProcess,["exec","execFile","fork","spawn"]]]) for (const name of names) target[name] = blocked;',
          "globalThis.fetch = blocked; syncBuiltinESMExports();"
        ].join("\n"),
        "utf8"
      );
      const probe = [
        `const module = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
        'const result = await module.retrieveDesignIntelligence({ query: "button", domains: ["components"], limit: 2 });',
        "process.stdout.write(JSON.stringify(result));"
      ].join("\n");
      const result = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(probePath).href, "--input-type=module", "-e", probe],
        { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir } }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /SIDE_EFFECT_ATTEMPT/);
      assert.doesNotThrow(() => JSON.parse(result.stdout));
      assert.deepEqual((await fs.readdir(dir)).sort(), ["deny-side-effects.mjs"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
