import { canonicalJson } from "./canonical-json.mjs";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

function finding(code, evidence) {
  return { code, evidence, severity: "high" };
}

function finiteBox(box) {
  return (
    box !== null &&
    typeof box === "object" &&
    ["left", "top", "right", "bottom"].every((key) => Number.isFinite(box[key]))
  );
}

export function inspectUiArtifact(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("UI artifact input must be an object");
  }
  const findings = [];
  if (input.kind === "accessibility-tree") {
    if (!Array.isArray(input.nodes)) throw new Error("accessibility-tree nodes must be an array");
    for (const node of input.nodes) {
      if (
        ["button", "link", "checkbox"].includes(node?.role) &&
        (typeof node.name !== "string" || node.name.trim().length === 0)
      ) findings.push(finding("WCAG_LABEL_MISSING", { node_id: node?.id }));
    }
  } else if (input.kind === "chart-bounds") {
    if (!finiteBox(input.plot) || !Array.isArray(input.series)) throw new Error("chart bounds are invalid");
    for (const series of input.series) {
      if (
        !finiteBox(series) ||
        series.left < input.plot.left ||
        series.top < input.plot.top ||
        series.right > input.plot.right ||
        series.bottom > input.plot.bottom
      ) findings.push(finding("VISUAL_DATA_CLIPPED", { series_id: series?.id }));
    }
  } else if (input.kind === "target-sizes") {
    if (!Number.isFinite(input.minimum) || !Array.isArray(input.targets)) throw new Error("target sizes are invalid");
    for (const target of input.targets) {
      if (
        !Number.isFinite(target?.width) ||
        !Number.isFinite(target?.height) ||
        target.width < input.minimum ||
        target.height < input.minimum
      ) findings.push(finding("WCAG_TARGET_SIZE", { target_id: target?.id }));
    }
  } else if (input.kind === "responsive-bounds") {
    if (!Number.isFinite(input.viewport_width) || !Array.isArray(input.content)) {
      throw new Error("responsive bounds are invalid");
    }
    for (const item of input.content) {
      if (
        !Number.isFinite(item?.left) ||
        !Number.isFinite(item?.right) ||
        item.left < 0 ||
        item.right > input.viewport_width
      ) findings.push(finding("RESPONSIVE_OVERFLOW", { content_id: item?.id }));
    }
  } else if (input.kind === "token-snapshot") {
    if (input.expected === undefined || input.actual === undefined) throw new Error("token snapshots are required");
    if (canonicalJson(input.expected) !== canonicalJson(input.actual)) {
      findings.push(finding("DESIGN_TOKEN_DRIFT", { compared: true }));
    }
  } else if (input.kind === "public-accessibility") {
    if (input.focus_visible !== true) findings.push(finding("WCAG_2_4_7_FOCUS_VISIBLE", {}));
    if (
      !Number.isFinite(input.contrast_ratio) ||
      !Number.isFinite(input.required_contrast_ratio) ||
      input.contrast_ratio < input.required_contrast_ratio
    ) findings.push(finding("WCAG_1_4_3_CONTRAST_MINIMUM", {}));
  } else if (input.kind === "chart-accessibility") {
    if (input.color_only_encoding === true) findings.push(finding("CHART_COLOR_ONLY_ENCODING", {}));
    if (typeof input.nonvisual_fallback !== "string" || input.nonvisual_fallback.trim() === "") {
      findings.push(finding("CHART_NONVISUAL_FALLBACK_MISSING", {}));
    }
  } else if (input.kind === "healthcare-safety") {
    if (input.destructive_confirmation !== true) {
      findings.push(finding("DESTRUCTIVE_ACTION_CONFIRMATION_MISSING", {}));
    }
    if (
      !Number.isFinite(input.minimum_target_size) ||
      !Number.isFinite(input.target?.width) ||
      !Number.isFinite(input.target?.height) ||
      input.target.width < input.minimum_target_size ||
      input.target.height < input.minimum_target_size
    ) findings.push(finding("WCAG_2_5_8_TARGET_SIZE_MINIMUM", {}));
  } else if (input.kind === "responsive-motion") {
    if (
      !Number.isFinite(input.content_right) ||
      !Number.isFinite(input.viewport_width) ||
      input.content_right > input.viewport_width
    ) findings.push(finding("RESPONSIVE_OVERFLOW", {}));
    if (input.reduced_motion_honored !== true) findings.push(finding("REDUCED_MOTION_NOT_HONORED", {}));
  } else if (input.kind === "brownfield-system") {
    if (input.token_reference_used !== true) findings.push(finding("DESIGN_TOKEN_BYPASS", {}));
    if (!Array.isArray(input.primitives)) throw new Error("brownfield primitives must be an array");
    const values = input.primitives.map((item) => canonicalJson(item?.value));
    if (new Set(values).size !== values.length) findings.push(finding("DUPLICATE_PRIMITIVE", {}));
  } else if (input.kind === "reference-fidelity") {
    const validDimensions = (value) =>
      Array.isArray(value) && value.length === 2 &&
      value.every((dimension) => Number.isFinite(dimension) && dimension > 0);
    if (!validDimensions(input.expected_dimensions) || !validDimensions(input.actual_dimensions)) {
      throw new Error("reference dimensions must be finite positive width-height arrays");
    }
    if (!sha256Pattern.test(input.expected_hash) || !sha256Pattern.test(input.actual_hash)) {
      throw new Error("reference hashes must be canonical sha256 identities");
    }
    if (canonicalJson(input.expected_dimensions) !== canonicalJson(input.actual_dimensions)) {
      findings.push(finding("REFERENCE_DIMENSION_MISMATCH", {}));
    }
    if (input.expected_hash !== input.actual_hash) {
      findings.push(finding("REFERENCE_SCREENSHOT_SUBSTITUTION", {}));
    }
  } else {
    throw new Error(`Unknown UI artifact kind: ${String(input.kind)}`);
  }
  return { findings, verdict: findings.length === 0 ? "PASS" : "REVISE" };
}
