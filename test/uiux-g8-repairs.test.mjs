import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createBetaMaterialEvidence,
  validBetaDesignContract,
  validEvidenceManifest
} from "../test-support/uiux-visual-fixtures.mjs";
import * as visualQa from "../skills/visual-qa/scripts/visual-qa.mjs";

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-g8-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeCaptureDirect(candidate) {
  const current = path.join(candidate.bundle.evidenceRoot, candidate.manifest.captures[0].path);
  const direct = path.join(candidate.bundle.evidenceRoot, "primary.png");
  if (current !== direct) fs.renameSync(current, direct);
  candidate.manifest.captures[0].path = "primary.png";
  return direct;
}

function reseal(candidate) {
  candidate.manifest.design_contract_hash = visualQa.hashCanonicalValue(candidate.bundle.designContract);
  candidate.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(candidate.manifest);
}

function explicitMaterialBundle(candidate, materialFileDescriptors, overrides = {}) {
  return {
    now: candidate.bundle.now,
    designContract: candidate.bundle.designContract,
    evidenceManifestBytes: candidate.bundle.evidenceManifestBytes,
    reviewReceipts: candidate.bundle.reviewReceipts,
    sourceBytes: candidate.bundle.sourceBytes,
    evidenceRoot: candidate.bundle.evidenceRoot,
    materialFileDescriptors,
    ...overrides
  };
}

function evaluateWithCloseProbe(candidate, descriptors, overrides = {}) {
  const unique = new Set(
    descriptors
      .map((item) => item?.descriptor)
      .filter((descriptor) => Number.isInteger(descriptor) && descriptor >= 0)
  );
  const counts = new Map([...unique].map((descriptor) => [descriptor, 0]));
  const originalClose = fs.closeSync;
  fs.closeSync = function countedClose(descriptor) {
    if (counts.has(descriptor)) counts.set(descriptor, counts.get(descriptor) + 1);
    return originalClose.call(this, descriptor);
  };
  let result;
  try {
    result = visualQa.evaluateEvidenceManifest(
      candidate.manifest,
      explicitMaterialBundle(candidate, descriptors, overrides)
    );
  } finally {
    fs.closeSync = originalClose;
    for (const descriptor of unique) {
      if (counts.get(descriptor) === 0) {
        try {
          originalClose(descriptor);
        } catch {
          // The evaluator may have closed through an unobserved native path.
        }
      }
    }
  }
  return { counts, result };
}

function assertClosedExactlyOnce(probe) {
  for (const [descriptor, count] of probe.counts) {
    assert.equal(count, 1, `transferred descriptor ${descriptor} must close exactly once`);
  }
}

test("visualqa beta material reads reject a final-file symlink swap at the read boundary", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  const capturePath = makeCaptureDirect(candidate);
  const captureAliases = new Set([path.resolve(capturePath), fs.realpathSync(capturePath)]);
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside.png`);
  fs.writeFileSync(outsidePath, candidate.captureBytes);
  t.after(() => fs.rmSync(outsidePath, { force: true }));

  const originalOpen = fs.openSync;
  const originalReadFile = fs.readFileSync;
  let attacked = false;
  const swap = (value) => {
    if (attacked || typeof value !== "string" || !captureAliases.has(path.resolve(value))) return;
    attacked = true;
    fs.rmSync(capturePath);
    fs.symlinkSync(outsidePath, capturePath);
  };
  fs.openSync = function guardedOpen(filePath, ...args) {
    swap(filePath);
    return originalOpen.call(this, filePath, ...args);
  };
  fs.readFileSync = function guardedRead(filePath, ...args) {
    swap(filePath);
    return originalReadFile.call(this, filePath, ...args);
  };
  try {
    const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
    assert.equal(attacked, true, "the test must replace the checked file immediately before opening it");
    assert.equal(result.verdict, "BLOCKED");
    assert.notEqual(result.verdict, "PASS");
  } finally {
    fs.openSync = originalOpen;
    fs.readFileSync = originalReadFile;
  }
});

test("visualqa beta material paths fail closed when they contain an unbound ancestor", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  const current = path.join(root, candidate.manifest.captures[0].path);
  const nestedDirectory = path.join(root, "nested");
  const nested = path.join(nestedDirectory, "primary.png");
  fs.mkdirSync(nestedDirectory, { recursive: true });
  if (current !== nested) fs.renameSync(current, nested);
  candidate.manifest.captures[0].path = "nested/primary.png";

  const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
  assert.equal(result.verdict, "BLOCKED");
  assert.match(JSON.stringify(result), /ancestor|direct child|nested|path|material capture/i);
});

test("visualqa beta inventory and check evidence pointers must resolve to hashed regular files", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  makeCaptureDirect(candidate);
  const pointer = candidate.manifest.mechanical_checks[0];
  fs.rmSync(path.join(root, pointer.evidence_path), { force: true });

  const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
  assert.equal(result.verdict, "BLOCKED");
  assert.notEqual(result.verdict, "PASS");
});

test("visualqa beta executable validator matches the schema 4096-character text boundary", () => {
  const schema = JSON.parse(
    fs.readFileSync("skills/visual-qa/schemas/evidence-manifest-v1beta1.json", "utf8")
  );
  assert.equal(schema.$defs.text.maxLength, 4096);
  const fields = [
    ["source_revision", (manifest, value) => { manifest.source_revision = value; }],
    ["capture_id", (manifest, value) => { manifest.captures[0].capture_id = value; }],
    ["inventory.id", (manifest, value) => { manifest.inventory[0].id = value; }],
    ["mechanical_checks.id", (manifest, value) => { manifest.mechanical_checks[0].id = value; }],
    ["cleanup.remaining", (manifest, value) => { manifest.cleanup.remaining = [value]; }]
  ];
  for (const [label, set] of fields) {
    const boundary = validEvidenceManifest({ tier: "smoke", contract: validBetaDesignContract() });
    boundary.schema_id = "litfamily.evidence-manifest/v1beta1";
    boundary.review_receipt_hashes = [];
    Object.assign(boundary.captures[0], {
      path: "primary.png",
      byte_length: 1,
      width: 1,
      height: 1
    });
    for (const item of boundary.inventory) item.evidence_path = "primary.png";
    boundary.mechanical_checks[0].channel = "tests";
    boundary.mechanical_checks[0].evidence_path = "mechanical.json";
    boundary.accessibility_checks[0].channel = "keyboard";
    boundary.accessibility_checks[0].evidence_path = "keyboard.json";
    boundary.tui_checks[0].channel = "tests";
    boundary.tui_checks[0].evidence_path = "tui.json";
    set(boundary, "x".repeat(4096));
    assert.equal(visualQa.validateEvidenceManifest(boundary).valid, true, `${label} must accept 4096 characters`);

    const oversized = structuredClone(boundary);
    set(oversized, "x".repeat(4097));
    assert.equal(visualQa.validateEvidenceManifest(oversized).valid, false, `${label} must reject 4097 characters`);
  }
});

test("visualqa beta evaluation reconciles the frozen contract source hash", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  makeCaptureDirect(candidate);
  candidate.bundle.designContract.source_hash = "f".repeat(64);
  reseal(candidate);

  assert.notEqual(
    visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle).verdict,
    "PASS"
  );
});

test("visualqa beta smoke cannot bypass contract-required independent review", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  makeCaptureDirect(candidate);
  candidate.bundle.designContract.evidence_policy.independent_review_required = true;
  reseal(candidate);

  const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.code, "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
});

test("visualqa beta evaluation rejects a contract-required channel absent from material evidence", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  makeCaptureDirect(candidate);
  candidate.bundle.designContract.evidence_policy.required_channels.push("performance");
  reseal(candidate);

  assert.notEqual(
    visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle).verdict,
    "PASS"
  );
});

test("visualqa root-only material input cannot pass an authorized-root swap and restore around child open", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  const parkedRoot = `${root}-parked`;
  const replacementRoot = `${root}-replacement`;
  fs.cpSync(root, replacementRoot, { recursive: true });
  t.after(() => {
    fs.rmSync(parkedRoot, { recursive: true, force: true });
    fs.rmSync(replacementRoot, { recursive: true, force: true });
  });

  const originalOpen = fs.openSync;
  const originalLstat = fs.lstatSync;
  const firstCapture = path.resolve(root, candidate.manifest.captures[0].path);
  let swapped = false;
  let restored = false;
  let captureLstats = 0;
  fs.openSync = function swapRootBeforeChildOpen(filePath, ...args) {
    if (!swapped && typeof filePath === "string" && path.resolve(filePath) === firstCapture) {
      fs.renameSync(root, parkedRoot);
      fs.renameSync(replacementRoot, root);
      swapped = true;
    }
    return originalOpen.call(this, filePath, ...args);
  };
  fs.lstatSync = function restoreRootAfterChildChecks(filePath, ...args) {
    const state = originalLstat.call(this, filePath, ...args);
    if (swapped && !restored && typeof filePath === "string" && path.resolve(filePath) === firstCapture) {
      captureLstats += 1;
      if (captureLstats === 2) {
        fs.renameSync(root, replacementRoot);
        fs.renameSync(parkedRoot, root);
        restored = true;
      }
    }
    return state;
  };
  try {
    const rootOnlyBundle = {
      now: candidate.bundle.now,
      designContract: candidate.bundle.designContract,
      evidenceManifestBytes: candidate.bundle.evidenceManifestBytes,
      reviewReceipts: candidate.bundle.reviewReceipts,
      sourceBytes: candidate.bundle.sourceBytes,
      evidenceRoot: candidate.bundle.evidenceRoot,
      materialFileDescriptors: undefined
    };
    const result = visualQa.evaluateEvidenceManifest(candidate.manifest, rootOnlyBundle);
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(swapped, false, "root-only input must be rejected before any lexical child open");
    assert.equal(restored, false, "no lexical child operation may exist to hide with an ABA restore");
  } finally {
    fs.openSync = originalOpen;
    fs.lstatSync = originalLstat;
    if (swapped && !restored) {
      fs.renameSync(root, replacementRoot);
      fs.renameSync(parkedRoot, root);
    }
  }
});

test("visualqa beta smoke binds immutable manifest bytes to the exact evaluated object", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  candidate.bundle.evidenceManifestBytes = Buffer.from('{"unrelated":true}');

  const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.code, "BLOCKED_IMMUTABLE_INPUT_MISMATCH");
});

test("visualqa not_applicable evidence cannot satisfy a contract-required channel", (t) => {
  const root = temporaryRoot(t);
  const candidate = createBetaMaterialEvidence(visualQa, root);
  const keyboard = candidate.manifest.accessibility_checks.find((item) => item.channel === "keyboard");
  keyboard.status = "not_applicable";
  candidate.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(candidate.manifest);

  const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.missingChannels, ["keyboard"]);
});

test("visualqa closes transferred descriptors on immutable-byte early return", (t) => {
  const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
  const descriptors = candidate.bundle.materialFileDescriptors;
  const probe = evaluateWithCloseProbe(candidate, descriptors, {
    evidenceManifestBytes: Buffer.from('{"unrelated":true}')
  });
  assert.equal(probe.result.code, "BLOCKED_IMMUTABLE_INPUT_MISMATCH");
  assertClosedExactlyOnce(probe);
});

test("visualqa closes transferred descriptors on source-mismatch early return", (t) => {
  const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
  candidate.bundle.designContract.source_hash = "f".repeat(64);
  reseal(candidate);
  const probe = evaluateWithCloseProbe(candidate, candidate.bundle.materialFileDescriptors);
  assert.equal(probe.result.code, "BLOCKED_IMMUTABLE_INPUT_MISMATCH");
  assertClosedExactlyOnce(probe);
});

test("visualqa owns and closes the rejected descriptor on duplicate labels", (t) => {
  const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
  const descriptors = candidate.bundle.materialFileDescriptors;
  descriptors.push({
    path: descriptors[0].path,
    descriptor: fs.openSync(
      path.join(candidate.bundle.evidenceRoot, descriptors[0].path),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    )
  });
  const probe = evaluateWithCloseProbe(candidate, descriptors);
  assert.equal(probe.result.verdict, "BLOCKED");
  assertClosedExactlyOnce(probe);
});

test("visualqa closes a reused transferred fd once while rejecting descriptor reuse", (t) => {
  const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
  const descriptors = candidate.bundle.materialFileDescriptors;
  descriptors.push({ path: "reused-label.json", descriptor: descriptors[0].descriptor });
  const probe = evaluateWithCloseProbe(candidate, descriptors);
  assert.equal(probe.result.verdict, "BLOCKED");
  assertClosedExactlyOnce(probe);
});

test("visualqa closes every unique transferred descriptor after success", (t) => {
  const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
  const probe = evaluateWithCloseProbe(candidate, candidate.bundle.materialFileDescriptors);
  assert.equal(probe.result.verdict, "PASS");
  assertClosedExactlyOnce(probe);
});

test("visualqa closes transferred descriptors for missing and extra descriptor sets", async (t) => {
  await t.test("missing", () => {
    const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
    const descriptors = candidate.bundle.materialFileDescriptors;
    const omitted = descriptors.pop();
    fs.closeSync(omitted.descriptor);
    const probe = evaluateWithCloseProbe(candidate, descriptors);
    assert.equal(probe.result.verdict, "BLOCKED");
    assertClosedExactlyOnce(probe);
  });
  await t.test("extra", () => {
    const candidate = createBetaMaterialEvidence(visualQa, temporaryRoot(t));
    const descriptors = candidate.bundle.materialFileDescriptors;
    const extraPath = path.join(candidate.bundle.evidenceRoot, "extra.json");
    fs.writeFileSync(extraPath, "extra");
    descriptors.push({
      path: "extra.json",
      descriptor: fs.openSync(
        extraPath,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
      )
    });
    const probe = evaluateWithCloseProbe(candidate, descriptors);
    assert.equal(probe.result.verdict, "BLOCKED");
    assertClosedExactlyOnce(probe);
  });
});

test("visualqa repeated blocked evaluations close every transfer without fd exhaustion", (t) => {
  const root = temporaryRoot(t);
  const originalClose = fs.closeSync;
  const allDescriptors = new Set();
  const liveTransfers = new Set();
  let transferred = 0;
  let closed = 0;
  fs.closeSync = function countedClose(descriptor) {
    if (liveTransfers.delete(descriptor)) closed += 1;
    return originalClose.call(this, descriptor);
  };
  try {
    for (let iteration = 0; iteration < 256; iteration += 1) {
      const candidate = createBetaMaterialEvidence(visualQa, root);
      const descriptors = candidate.bundle.materialFileDescriptors;
      for (const item of descriptors) {
        allDescriptors.add(item.descriptor);
        liveTransfers.add(item.descriptor);
      }
      transferred += new Set(descriptors.map((item) => item.descriptor)).size;
      const result = visualQa.evaluateEvidenceManifest(candidate.manifest, explicitMaterialBundle(
        candidate,
        descriptors,
        { evidenceManifestBytes: Buffer.from('{"unrelated":true}') }
      ));
      assert.equal(result.verdict, "BLOCKED");
    }
  } finally {
    fs.closeSync = originalClose;
    for (const descriptor of allDescriptors) {
      try {
        originalClose(descriptor);
      } catch {
        // Already closed transfers are the expected GREEN state.
      }
    }
  }
  assert.equal(closed, transferred);
  const probe = fs.openSync(path.join(root, "post-loop-probe"), fs.constants.O_CREAT | fs.constants.O_RDWR, 0o600);
  fs.closeSync(probe);
});
