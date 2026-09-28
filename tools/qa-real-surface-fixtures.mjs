#!/usr/bin/env node
// Fixture builders for the replacement real-surface QA layer.
//
// This module deliberately duplicates shapes that also exist under test-support/.
// The replacement QA layer has to keep proving behaviour after the tracked test
// and fixture clutter is removed, so it may not import anything from test/ or
// test-support/. Nothing here validates: every rule is enforced by the shipped
// validators the drivers call.
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const hash = (character) => `sha256:${character.repeat(64)}`;
const digest = (character) => character.repeat(64);

function openMaterialFileDescriptors(evidenceRoot, manifest) {
  const paths = new Set([
    ...manifest.captures.map((item) => item.path),
    ...manifest.inventory.map((item) => item.evidence_path),
    ...["mechanical_checks", "accessibility_checks", "tui_checks"].flatMap(
      (field) => manifest[field].map((item) => item.evidence_path)
    )
  ]);
  const opened = [];
  try {
    for (const evidencePath of paths) {
      opened.push({
        path: evidencePath,
        descriptor: fs.openSync(
          path.join(evidenceRoot, evidencePath),
          fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
        )
      });
    }
    return opened;
  } catch (error) {
    for (const item of opened) fs.closeSync(item.descriptor);
    throw error;
  }
}

// Evidence kind the shipped Visual QA reconciler expects for each id-bearing
// Design Contract inventory category.
export const contractEvidenceKinds = Object.freeze({
  routes: "route",
  regions: "region",
  components: "component",
  interactions: "interaction",
  states: "state",
  viewports: "viewport",
  references: "reference-comparison"
});

function baseDesignContract() {
  return {
    schema_id: "litfamily.design-contract/v1alpha1",
    contract_id: "contract:qa-real-surface",
    source_hash: digest("a"),
    intent: {
      audiences: ["First-time applicants"],
      tasks: ["Submit an application and check its status"],
      qualities: ["Legible", "Predictable"],
      constraints: ["No new runtime dependencies."],
      non_goals: ["Native mobile shell."]
    },
    direction: {
      name: "Quiet civic clarity",
      principles: [
        "Visible focus on every interactive surface",
        "One primary action per region",
        "Text before decoration"
      ],
      token_strategy: "reuse",
      voice: "Plain, specific, unhurried."
    },
    inventory: {
      routes: [
        { id: "route:apply", path: "/apply", primary: true, auth_required: false },
        { id: "route:status", path: "/status", primary: false, auth_required: true }
      ],
      regions: [{ id: "region:apply-form", route_id: "route:apply" }],
      components: [{ id: "component:submit-button", region_id: "region:apply-form" }],
      interactions: [
        {
          id: "interaction:submit-application",
          route_id: "route:apply",
          critical: true,
          input_modes: ["keyboard", "pointer"]
        }
      ],
      states: [
        { id: "state:apply-loading", route_id: "route:apply", kind: "loading" },
        { id: "state:apply-error", route_id: "route:apply", kind: "error" }
      ],
      viewports: [
        { id: "viewport:compact", width: 390, height: 844, category: "compact" },
        { id: "viewport:expanded", width: 1440, height: 900, category: "expanded" }
      ],
      references: [
        { id: "reference:current-form", sha256: digest("b"), kind: "repo-local", label: "Current form capture" }
      ],
      authenticated_surfaces: [
        { route_id: "route:status", owner: "owned-test-account", safe_test_account: true }
      ]
    },
    accessibility: {
      target: "WCAG 2.2 AA",
      keyboard: true,
      screen_reader: true,
      reduced_motion: true,
      forced_colors: true,
      zoom_percent: 200
    },
    localization: {
      locales: ["ko-KR", "en-US"],
      text_expansion_percent: 30,
      cjk_line_break_review: true,
      font_fallback_review: true,
      ime_review: true,
      rtl_review: false
    },
    performance: { lcp_ms: 2500, cls: 0.1, inp_ms: 200, initial_js_kb: 180, initial_css_kb: 60 },
    evidence_policy: {
      independent_review_required: true,
      required_channels: ["tests", "browser", "keyboard", "accessibility-tree"],
      cleanup_required: true
    },
    omissions: [{ id: "omission:offline-mode", reason: "Offline scope was not requested.", owner: "product" }],
    accepted_exceptions: [
      {
        id: "exception:legacy-chart",
        reason: "Chart migration is staged.",
        owner: "design",
        expires_at: "2026-12-31T00:00:00.000Z"
      }
    ]
  };
}

export function validDesignContract() {
  return validBetaDesignContract();
}

function validBetaDesignContract() {
  return {
    ...baseDesignContract(),
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

function inventoryItem(kind, id = `${kind}/one`) {
  return {
    id,
    kind,
    status: "captured",
    exception_id: null,
    evidence_path: `captures/${kind}.png`,
    evidence_hash: hash("b")
  };
}

function check(id) {
  return { id, status: "pass", evidence_path: `checks/${id}.json`, evidence_hash: hash("7") };
}

function reconciledInventory(contract, kinds) {
  const declared = Object.entries(contractEvidenceKinds).flatMap(([category, kind]) =>
    contract.inventory[category].map((item) => inventoryItem(kind, item.id))
  );
  const covered = new Set(declared.map((item) => item.kind));
  return [
    ...declared,
    ...kinds.filter((kind) => !covered.has(kind)).map((kind) => inventoryItem(kind, `evidence:${kind}`))
  ];
}

export function validEvidenceManifest({ tier = "full", contract } = {}) {
  const kinds = tier === "smoke"
    ? ["route", "interaction", "viewport-min", "viewport-max"]
    : ["route", "screen", "state", "viewport", "theme", "permission", "auth", "error", "loading", "empty", "tui-size"];
  if (tier === "reference-fidelity") kinds.push("reference-comparison");
  return {
    schema_id: "litfamily.evidence-manifest/v1alpha1",
    design_contract_hash: hash("a"),
    source_revision: "git:qa-real-surface",
    tier,
    created_at: "2026-07-24T00:00:00.000Z",
    maximum_age_seconds: 600,
    freshness: {
      assessed_at: "2026-07-24T00:05:00.000Z",
      expires_at: "2026-07-24T00:10:00.000Z",
      fresh: true,
      contract_hash_match: true,
      source_hash_match: true,
      capture_hash_match: true
    },
    capabilities: { capture: true, auth: true, test_account_safe: true, independent_review: true },
    captures: [{
      capture_id: "capture/one",
      source_hash: hash("c"),
      capture_hash: hash("d"),
      created_at: "2026-07-24T00:00:00.000Z",
      viewport: "1280x720",
      dpr: 2,
      os: "qa-os",
      runtime: "qa-browser",
      runtime_version: "1",
      font_set: ["system-ui"],
      locale: "ko-KR",
      reduced_motion: true,
      animation_settling: "animations disabled",
      color_scheme: "light",
      auth_owner: "owned-test-account",
      process_owner: "session/qa"
    }],
    inventory: contract === undefined
      ? kinds.map((kind) => inventoryItem(kind))
      : reconciledInventory(contract, kinds),
    mechanical_checks: [check("mechanical")],
    accessibility_checks: [check("accessibility")],
    tui_checks: [check("tui")],
    review_receipt_hashes: [hash("e"), hash("f")],
    findings: [],
    exception_references: [],
    cleanup: { owned_processes_stopped: true, temporary_artifacts_removed: true, remaining: [] },
    verdict: "PASS"
  };
}

export function validReviewReceipt({
  id,
  reviewer = "reviewer-a",
  context = "context-a",
  capability = "product-inspection",
  endedAt = "2026-07-24T00:02:00.000Z",
  findings = [],
  verdict = "PASS"
} = {}) {
  return {
    schema_id: "litfamily.review-receipt/v1alpha1",
    review_id: id ?? `review/${reviewer}`,
    reviewer_id: reviewer,
    fresh_context_id: context,
    reviewer_capability_class: capability,
    input_hashes: {
      design_contract: hash("a"),
      evidence_manifest: hash("b"),
      source: hash("c"),
      capture: hash("d")
    },
    reviewed_inventory: [{ id: "route/one", kind: "route", status: "captured" }],
    findings,
    confidence: 0.95,
    independence_assertion: {
      fresh_context: true,
      same_immutable_inputs: true,
      other_draft_received: false,
      other_verdict_received: false
    },
    started_at: new Date(Date.parse(endedAt) - 60_000).toISOString(),
    ended_at: endedAt,
    timeout_seconds: 600,
    timed_out: false,
    cancelled: false,
    cancellation_reason: null,
    round: 1,
    verdict
  };
}

// Assembles a beta Design Contract, material Evidence Manifest, and source bytes
// into the exact smoke bundle shape the shipped evaluator accepts.
export function buildEvidenceBundle(
  visualQa,
  evidenceRoot,
  { captureBytes = rgbaPng(1, 1, [10, 20, 30, 255]) } = {}
) {
  if (typeof evidenceRoot !== "string" || evidenceRoot.length === 0) {
    throw new Error("buildEvidenceBundle requires an isolated evidence root");
  }
  const capturePath = "primary.png";
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, capturePath), captureBytes);

  const designContract = validBetaDesignContract();
  designContract.inventory.routes = designContract.inventory.routes.filter((route) => !route.auth_required);
  designContract.inventory.authenticated_surfaces = [];
  designContract.evidence_policy.independent_review_required = false;
  const sourceBytes = Buffer.from("qa-real-surface beta source bytes");
  designContract.source_hash = visualQa.hashBytes(sourceBytes).slice("sha256:".length);

  const manifest = validEvidenceManifest({ tier: "smoke", contract: designContract });
  manifest.schema_id = "litfamily.evidence-manifest/v1beta1";
  manifest.capabilities = {
    capture: true,
    auth: false,
    test_account_safe: false,
    independent_review: false
  };
  manifest.captures[0] = {
    ...manifest.captures[0],
    path: capturePath,
    byte_length: captureBytes.length,
    width: 1,
    height: 1,
    source_hash: visualQa.hashBytes(sourceBytes),
    capture_hash: visualQa.hashBytes(captureBytes),
    viewport: "1x1"
  };
  manifest.review_receipt_hashes = [];
  manifest.design_contract_hash = visualQa.hashCanonicalValue(designContract);
  for (const item of manifest.inventory) {
    item.evidence_path = capturePath;
    item.evidence_hash = visualQa.hashBytes(captureBytes);
  }
  const materialChecks = [
    [manifest.mechanical_checks[0], "tests", "mechanical.json"],
    [{ ...manifest.mechanical_checks[0], id: "browser" }, "browser", "browser.json"],
    [manifest.accessibility_checks[0], "keyboard", "keyboard.json"],
    [{ ...manifest.accessibility_checks[0], id: "accessibility-tree" }, "accessibility-tree", "accessibility-tree.json"],
    [manifest.tui_checks[0], "tests", "tui.json"]
  ];
  manifest.mechanical_checks.push(materialChecks[1][0]);
  manifest.accessibility_checks.push(materialChecks[3][0]);
  for (const [item, channel, evidencePath] of materialChecks) {
    const bytes = Buffer.from(JSON.stringify({ channel, id: item.id }));
    fs.writeFileSync(path.join(evidenceRoot, evidencePath), bytes);
    item.channel = channel;
    item.evidence_path = evidencePath;
    item.evidence_hash = visualQa.hashBytes(bytes);
  }

  const bundle = {
    now: "2026-07-24T00:05:00.000Z",
    designContract,
    evidenceManifestBytes: visualQa.canonicalEvidenceManifestBytes(manifest),
    reviewReceipts: [],
    sourceBytes,
    evidenceRoot
  };
  Object.defineProperty(bundle, "materialFileDescriptors", {
    enumerable: true,
    get() {
      return openMaterialFileDescriptors(evidenceRoot, manifest);
    }
  });
  return {
    designContract,
    manifest,
    bundle
  };
}

export function buildValidSmokeEvidenceBundle(visualQa, evidenceRoot) {
  return buildEvidenceBundle(visualQa, evidenceRoot);
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

export function rgbaPng(width, height, channels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    rows.push(Buffer.from([0]), Buffer.from(channels.slice(row * width * 4, (row + 1) * width * 4)));
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// A topologically sound single box with CJK content. Every border cell has the
// neighbour its connection set demands and every bordered row is six columns
// wide once wide graphemes are counted as two columns.
export const boundedCjkBox = "┌────┐\n│한글│\n└────┘";
