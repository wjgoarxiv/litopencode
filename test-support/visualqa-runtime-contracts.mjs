import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { rgbaPng, validReviewReceipt } from "./uiux-visual-fixtures.mjs";

async function importCapabilityModule(filePath, capabilityId) {
  try {
    const stat = await fs.stat(filePath);
    assert.equal(stat.isFile(), true);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      assert.fail(`${capabilityId}: missing capability file ${filePath}`);
    }
    throw error;
  }
  return await import(pathToFileURL(path.resolve(filePath)).href);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function onePixelPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export function registerVisualQaRuntimeContracts() {
  test("visualqa.blocked-capabilities", async () => {
    const module = await importCapabilityModule(
      "skills/visual-qa/scripts/visual-qa.mjs",
      "visualqa.blocked-capabilities"
    );
    const result = await module.evaluateCapabilityBlocks({
      captureAvailable: false,
      authAvailable: false,
      testAccountSafe: false,
      independentReviewAvailable: false
    });
    assert.deepEqual(result.codes, [
      "BLOCKED_RENDERER_UNAVAILABLE",
      "BLOCKED_AUTH_UNAVAILABLE",
      "BLOCKED_TEST_ACCOUNT_UNSAFE",
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
    ]);
    assert.notEqual(result.verdict, "PASS");
    assert.deepEqual(await module.evaluateCapabilityBlocks({}), result);

    // Every code the skill can emit has to be declared, and the two lists must
    // stay disjoint so a BLOCKED name can never carry a FAIL verdict.
    for (const code of [
      "BLOCKED_AUTH_UNAVAILABLE",
      "BLOCKED_RENDERER_UNAVAILABLE",
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
      "BLOCKED_TEST_ACCOUNT_UNSAFE",
      "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
      "BLOCKED_EVIDENCE_STALE",
      "BLOCKED_EVIDENCE_FUTURE",
      "BLOCKED_CLEANUP_INCOMPLETE"
    ]) {
      assert.ok(module.visualQaBlockedCodes.includes(code), `blocked vocabulary must declare ${code}`);
    }
    assert.ok(module.visualQaBlockedCodes.every((code) => code.startsWith("BLOCKED_")));
    assert.ok(module.visualQaFailCodes.every((code) => code.startsWith("FAIL_")));
    assert.equal(
      module.visualQaFailCodes.some((code) => module.visualQaBlockedCodes.includes(code)),
      false
    );

    // An owned renderer is proven per element; anything short of that is an absent
    // capability rather than a defect in the reviewed interface.
    const owned = {
      command: "npm run test:visual",
      pid: 4242,
      port: 4173,
      projectRoot: "/projects/example",
      sessionId: "session/one",
      sessionScoped: true
    };
    assert.deepEqual(await module.evaluateRendererOwnership(owned), {
      codes: [],
      unproven: [],
      verdict: "READY"
    });
    for (const [field, value] of [
      ["command", ""],
      ["pid", 0],
      ["port", 70000],
      ["projectRoot", " "],
      ["sessionId", undefined],
      ["sessionScoped", false]
    ]) {
      const probe = await module.evaluateRendererOwnership({ ...owned, [field]: value });
      assert.deepEqual(probe.codes, ["BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED"], field);
      assert.deepEqual(probe.unproven, [field], field);
      assert.equal(probe.verdict, "BLOCKED", field);
    }
    assert.deepEqual((await module.evaluateRendererOwnership({})).codes, [
      "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED"
    ]);

    // Evidence dated ahead of its own assessment is a broken clock, not old
    // evidence, so it must not be reported as stale.
    const freshnessInput = {
      createdAt: "2026-07-24T00:00:00.000Z",
      maximumAgeSeconds: 600,
      expectedSourceHash: `sha256:${"1".repeat(64)}`,
      actualSourceHash: `sha256:${"1".repeat(64)}`,
      expectedCaptureHash: `sha256:${"2".repeat(64)}`,
      actualCaptureHash: `sha256:${"2".repeat(64)}`
    };
    assert.equal(
      (await module.evaluateEvidenceFreshness({ ...freshnessInput, now: "2026-07-23T23:59:59.000Z" })).code,
      "BLOCKED_EVIDENCE_FUTURE"
    );
    assert.equal(
      (await module.evaluateEvidenceFreshness({ ...freshnessInput, now: "2026-07-24T00:10:01.000Z" })).code,
      "BLOCKED_EVIDENCE_STALE"
    );
  });

  test("visualqa.png-resource-bounds", async () => {
    const module = await importCapabilityModule(
      "skills/visual-qa/scripts/visual-qa.mjs",
      "visualqa.png-resource-bounds"
    );
    const oversizedHeader = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(oversizedHeader);
    oversizedHeader.writeUInt32BE(13, 8);
    oversizedHeader.write("IHDR", 12, "ascii");
    oversizedHeader.writeUInt32BE(16_385, 16);
    oversizedHeader.writeUInt32BE(1, 20);
    const oversized = await module.inspectPng(oversizedHeader);
    assert.equal(oversized.ok, false);
    assert.match(oversized.code, /PNG_(?:DIMENSION|RESOURCE)_LIMIT/);
    assert.equal(oversized.similarity, undefined);

    const validPng = onePixelPng();
    assert.equal((await module.inspectPng(validPng)).ok, true);
    const crcCorrupted = Buffer.from(validPng);
    crcCorrupted[crcCorrupted.length - 1] ^= 0xff;
    const crcResult = await module.inspectPng(crcCorrupted);
    assert.equal(crcResult.code, "PNG_CRC_INVALID");
    assert.equal(crcResult.similarity, undefined);
    const truncated = await module.inspectPng(validPng.subarray(0, validPng.length - 3));
    assert.equal(truncated.code, "PNG_TRUNCATED");
    assert.equal(truncated.similarity, undefined);

    const opaque = rgbaPng(2, 1, [
      [10, 20, 30, 255],
      [40, 50, 60, 255]
    ]);
    const transparent = rgbaPng(2, 1, [
      [10, 20, 30, 0],
      [40, 50, 60, 128]
    ]);
    const compared = await module.comparePngs(opaque, transparent);
    assert.equal(compared.ok, true);
    assert.equal(compared.alphaDamagedPixels, 2);
    assert.ok(compared.similarity < 1);

    const dimensionMismatch = await module.comparePngs(opaque, rgbaPng(1, 1, [[10, 20, 30, 255]]));
    assert.equal(dimensionMismatch.code, "PNG_DIMENSION_MISMATCH");
    assert.equal(dimensionMismatch.similarity, undefined);
  });

  test("visualqa.tui-unicode-osc", async () => {
    const module = await importCapabilityModule(
      "skills/visual-qa/scripts/visual-qa.mjs",
      "visualqa.tui-unicode-osc"
    );
    const result = await module.inspectTui(
      "┌────┐\n│한👩‍💻é\u001b]8;;https://example.invalid\u0007x\u001b]8;;\u0007│\n└───┘",
      { ambiguousWidth: 2 }
    );
    assert.equal(result.controlSequencesInert, true);
    assert.ok(result.findings.some((finding) => /border/i.test(finding.code)));
    assert.ok(result.rows.some((row) => row.graphemes.some((item) => item.text === "👩‍💻")));
    assert.ok(result.rows.some((row) => row.graphemes.some((item) => item.text === "한" && item.width === 2)));

    const c1Result = await module.inspectTui(
      "┌──┐\n│\u009d8;;https://example.invalid\u009cx\u009d8;;\u009c│\n└──┘"
    );
    assert.equal(c1Result.controlSequencesInert, true);
    assert.equal(JSON.stringify(c1Result).includes("example.invalid"), false);

    const broken = await module.inspectTui("┌──┐\n│한 │\n└─ ┘");
    assert.ok(broken.findings.some((finding) => finding.code === "TUI_BORDER_TOPOLOGY_BROKEN"));
    assert.ok(
      broken.findings.some(
        (finding) => finding.code === "TUI_BORDER_TOPOLOGY_BROKEN" && finding.severity === "high"
      )
    );
    const validDisplayCells = await module.inspectTui("┌────┐\n│한👩‍💻│\n└────┘");
    assert.deepEqual(validDisplayCells.findings, []);
    const brokenDisplayCells = await module.inspectTui("┌────┐\n│한👩‍💻 │\n└────┘");
    assert.ok(
      brokenDisplayCells.findings.some((finding) => finding.code === "TUI_BORDER_TOPOLOGY_BROKEN")
    );
  });

  test("visualqa.review-independence", async () => {
    const module = await importCapabilityModule(
      "skills/visual-qa/scripts/visual-qa.mjs",
      "visualqa.review-independence"
    );
    const receiptA = validReviewReceipt();
    const receiptB = validReviewReceipt({
      id: "review-b",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b"
    });
    assert.deepEqual(module.validateReviewReceipt(receiptA), { ok: true, errors: [] });
    const independent = await module.validateReviewIndependence([receiptA, receiptB], {
      now: "2026-07-24T00:06:00.000Z"
    });
    assert.equal(independent.independent, true);
    assert.equal(independent.verdict, "PASS");

    const failedB = validReviewReceipt({
      id: "review-failed",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b",
      verdict: "FAIL"
    });
    // A review that ran and rejected the work is a FAIL, never a BLOCKED code: the
    // capability was present, the answer was no.
    const failedResult = await module.validateReviewIndependence([receiptA, failedB], {
      now: "2026-07-24T00:06:00.000Z"
    });
    assert.equal(failedResult.code, "FAIL_REVIEW_VERDICT");
    assert.equal(failedResult.verdict, "FAIL");
    const criticalB = validReviewReceipt({
      id: "review-critical",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b",
      findings: [{
        code: "CRITICAL_DEFECT",
        severity: "critical",
        evidence_pointers: [{ path: "captures/critical.png", hash: `sha256:${"9".repeat(64)}` }],
        message: "Critical defect remains."
      }]
    });
    const criticalResult = await module.validateReviewIndependence([receiptA, criticalB], {
      now: "2026-07-24T00:06:00.000Z"
    });
    assert.equal(criticalResult.code, "FAIL_REVIEW_GATING_FINDING");
    assert.equal(criticalResult.verdict, "FAIL");

    // BLOCKED outranks FAIL: a rejected review whose receipts are also stale must
    // report the absent capability, because the stale bytes make the rejection
    // unverifiable.
    const staleFail = validReviewReceipt({
      id: "review-stale-fail",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b",
      endedAt: "2026-07-23T20:00:00.000Z",
      verdict: "FAIL"
    });
    assert.equal(
      (
        await module.validateReviewIndependence(
          [validReviewReceipt({ endedAt: "2026-07-23T20:00:00.000Z" }), staleFail],
          { now: "2026-07-24T00:06:00.000Z" }
        )
      ).code,
      "BLOCKED_EVIDENCE_STALE"
    );

    receiptB.fresh_context_id = receiptA.fresh_context_id;
    const sharedContext = await module.validateReviewIndependence([receiptA, receiptB], {
      now: "2026-07-24T00:06:00.000Z"
    });
    assert.equal(sharedContext.independent, false);
    assert.equal(sharedContext.code, "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");

    const timedOut = validReviewReceipt({ id: "review-timeout", status: "timed_out" });
    const timeoutResult = await module.validateReviewIndependence([receiptA, timedOut], {
      now: "2026-07-24T00:06:00.000Z"
    });
    assert.equal(timeoutResult.code, "BLOCKED_REVIEW_TIMEOUT");

    const cancelled = validReviewReceipt({ id: "review-cancelled", status: "cancelled" });
    assert.equal(
      (
        await module.validateReviewIndependence([receiptA, cancelled], {
          now: "2026-07-24T00:06:00.000Z"
        })
      ).independent,
      false
    );

    const staleA = validReviewReceipt({ endedAt: "2026-07-23T20:00:00.000Z" });
    const staleB = validReviewReceipt({
      id: "review-stale-b",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b",
      endedAt: "2026-07-23T20:00:00.000Z"
    });
    assert.equal(
      (
        await module.validateReviewIndependence([staleA, staleB], {
          now: "2026-07-24T00:06:00.000Z"
        })
      ).code,
      "BLOCKED_EVIDENCE_STALE"
    );
  });
}
