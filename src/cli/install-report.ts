import type { InstallReport } from "./types.ts";
import { shippedDefaultsSummary } from "./model-catalog.ts";

const reset = "\u001b[0m";
const green = "\u001b[38;5;82m";
const cyan = "\u001b[1;38;5;81m";
const muted = "\u001b[38;5;245m";

function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined && process.env.CI === undefined;
}

function tint(value: string, code: string): string {
  if (!useColor()) return value;
  return code + value + reset;
}

function padLabel(label: string): string {
  return label.padEnd(18, " ");
}

function cellWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\p{Mark}/u.test(character) || codePoint === 0x200d) continue;
    const wide =
      codePoint >= 0x1100 &&
      (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff));
    width += wide ? 2 : 1;
  }
  return width;
}

function splitLongWord(word: string, width: number): readonly string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    if (chunk.length > 0 && cellWidth(chunk + character) > width) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk += character;
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function wrapValue(value: string, width: number): readonly string[] {
  const words = value.trim().split(/\s+/u).flatMap((word) => splitLongWord(word, width));
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : current + " " + word;
    if (current.length > 0 && cellWidth(candidate) > width) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [""];
}

// A one-line receipt printed after the report, wrapped at whole words like every report line.
export function wrapReceiptLine(value: string): string {
  return wrapValue(value, 80).join("\n");
}

function line(label: string, value: string): string {
  const prefix = "  " + padLabel(label) + " ";
  const continuation = " ".repeat(prefix.length);
  return wrapValue(value, 80 - prefix.length)
    .map((part, index) => (index === 0 ? prefix : continuation) + part)
    .join("\n");
}

function section(title: string): readonly string[] {
  return ["", "  " + tint(title, muted)];
}

function modelRoute(report: InstallReport): string {
  const model = report.litopencodeConfig.model;
  if (model.provider && model.model) {
    const lead = model.provider + "/" + model.model;
    return model.helper === undefined ? lead : lead + " lead; " + model.helper.provider + "/" + model.helper.model + " helpers";
  }
  if (model.classification.originalDispatchId) return model.classification.originalDispatchId;
  if (model.classification.class === "fresh") return "Role-split shipped defaults";
  return "OpenCode session default";
}

function existingRoute(report: InstallReport): string {
  const model = report.litopencodeConfig.model;
  if (model.classification.originalDispatchId === null) return model.classification.class;
  return model.classification.originalDispatchId + (model.existingVariant === undefined ? "" : " (" + model.existingVariant + ")");
}

function permissionRoute(report: InstallReport): string {
  if (report.litopencodeConfig.permissionMode.mode === "balanced") {
    return "Balanced (allow routine work; ask for dangerous bash)";
  }
  if (report.litopencodeConfig.permissionMode.mode === "yolo") {
    return "YOLO (allow bash/edit/task/webfetch/external_directory; lit-plan stays deny)";
  }
  return "Safe / ask-first";
}

function actionLines(report: InstallReport): readonly string[] {
  const pluginChanged = report.patch.length > 0;
  const routeAction = report.litopencodeConfig.changed
    ? report.litopencodeConfig.alreadyPresent
      ? "litopencode.json updated"
      : "litopencode.json created"
    : "litopencode.json preserved";

  return [
    pluginChanged ? "plugin[] updated" : "plugin[] already ready",
    routeAction,
    report.hostLimits.reconfigure
      ? report.hostLimits.changed
        ? "OpenCode context and compaction limits updated"
        : "OpenCode context and compaction limits already ready"
      : "OpenCode context and compaction limits preserved; select LUNA to reconfigure",
    report.commandAliases.changed ? "command aliases written" : "command aliases preserved",
    report.nativeSkills.changed ? "native skills written" : "native skills preserved"
  ];
}

function progressLine(label: string): string {
  return "  " + tint("[ok]", green) + " " + label;
}

// A symlinked <root>/skills is intentional and install still succeeds; these lines only make the
// resolved destination visible, and warn when that destination is a git work tree a managed install
// would write dozens of skill directories into (see the ~/skills incident this guards against).
function nativeSkillsLinkLines(report: InstallReport): readonly string[] {
  const link = report.nativeSkills.link;
  if (link === undefined) return [];
  const lines = [line("Native skills link", link.path + " -> " + link.target + " (linked directory)")];
  if (link.gitRepositoryRoot !== undefined) {
    lines.push(
      line(
        "Warning",
        "linked native skills target is inside git repository " +
          link.gitRepositoryRoot +
          "; managed skills will appear inside that repository"
      )
    );
  }
  return lines;
}

function headerLine(label: string, code: string): string {
  return "| " + tint(label.padEnd(58, " "), code) + " |";
}

export function renderInstallReport(report: InstallReport): string {
  const changed = report.changed || report.litopencodeConfig.changed || report.commandAliases.changed;
  const status = changed ? "Complete" : "Already installed";
  const actions = actionLines(report);

  return [
    "+------------------------------------------------------------+",
    headerLine("LitOpenCode installer", cyan),
    headerLine("OpenCode plugin setup", muted),
    "+------------------------------------------------------------+",
    ...section("Install summary"),
    line("Package", report.package.name + "@" + report.package.version),
    line("Status", status),
    line("Result", actions[0]),
    line("", actions[1]),
    line("", actions[2]),
    line("", actions[3]),
    line("", actions[4]),
    ...section("Routes"),
    line("Model", modelRoute(report)),
    line("Effort", report.litopencodeConfig.model.effort ?? "preserve existing"),
    line("Existing route", existingRoute(report)),
    line("Route class", report.litopencodeConfig.model.classification.class),
    line("Permissions", permissionRoute(report)),
    line("Authority lifecycle", "schema 3; bounded history/context; trusted resume only"),
    line("Agents", "lit-loop, lit-plan, lit-implement"),
    line("Shipped defaults", shippedDefaultsSummary()),
    line("Override order", "project merges after global; per-agent routes override categories"),
    line("Coverage", report.litopencodeConfig.agents.length + " agents / " + report.litopencodeConfig.categories.length + " categories"),
    ...section("Host capabilities"),
    line("Context ceiling 372K", report.capabilities.contextCeiling372k.status),
    line("Compaction 334.8K", report.capabilities.autoCompaction334800.status),
    line("Concurrency 20", report.capabilities.subagentConcurrency20.status),
    ...section("Files"),
    line("OpenCode config", report.path),
    line("Host limits", report.hostLimits.path),
    line("LitOpenCode config", report.litopencodeConfig.path),
    line("Command aliases", report.commandAliases.write.length + " managed / " + report.commandAliases.preserve.length + " preserved"),
    line("Native skills", report.nativeSkills.write.length + " managed / " + report.nativeSkills.preserve.length + " preserved"),
    ...nativeSkillsLinkLines(report),
    line("Plugin entries", report.plugin.currentCount + " -> " + report.plugin.resultCount),
    ...section("Progress"),
    progressLine("Resolve package"),
    progressLine("Read OpenCode config"),
    progressLine("Write litopencode.json"),
    progressLine("Register plugin"),
    progressLine("Verify install"),
    ...section("Next"),
    "  Restart OpenCode, press Tab, then choose lit-loop, lit-plan, or lit-implement."
  ].join("\n");
}
