import { isLoopCommand, parseArgs } from "./cli/args.ts";
import { runLoopCommand } from "./cli/loop.ts";
import { doctor } from "./cli/doctor.ts";
import { install } from "./cli/install.ts";
import { createInstallTui, renderLitOpenCodeWordmark, shouldRenderInstallTui } from "./cli/install-tui.ts";
import type { CliResult, InstallProgress, ParsedArgs } from "./cli/types.ts";
import { runUpdateNotifier } from "./cli/update-notifier.ts";
import { autoUpdateDiagnostic, canContinueAfterAutoUpdate, runInteractiveAutoUpdate } from "./cli/auto-update.ts";
import { LitOpenCodeConfigError } from "./config.ts";
import { defaultOpenAiRoutes, legacyFastAliasHelp, modelEffortHelp, openaiModelHelpLine, shippedDefaultsSummary } from "./cli/model-catalog.ts";
import { fetchPublicSource } from "./lit-fetch.ts";
import { readPackageMetadata } from "./cli/json.ts";
import { runMotionRuntime } from "./cli/motion-runtime.ts";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RunCliOptions = {
  readonly installProgress?: InstallProgress;
};

function helpText(): string {
  return [
    "litopencode",
    "",
    "Install LitOpenCode into OpenCode with an explicit npm package.",
    "",
    "Quick start:",
    "  npm exec --package @litfamily/litopencode -- litopencode install",
    "  npm exec --package @litfamily/litopencode -- litopencode fetch-public https://example.com --json",
    "  npm exec --package @litfamily/litopencode -- litopencode install --permission-prompt",
    "  npm exec --package @litfamily/litopencode -- litopencode install --permission-mode balanced",
    "  npm exec --package @litfamily/litopencode -- litopencode install --yolo",
    `  npm exec --package @litfamily/litopencode -- litopencode install --provider openai --model ${defaultOpenAiRoutes.lead.model} --effort ${defaultOpenAiRoutes.lead.effort}`,
    `  npm exec --package @litfamily/litopencode -- litopencode install --provider openai --model ${defaultOpenAiRoutes.helper.model} --effort ${defaultOpenAiRoutes.helper.effort}`,
    `  npm exec --package @litfamily/litopencode -- litopencode install --provider openai --model ${defaultOpenAiRoutes.helper.model} --effort high`,
    "",
    "Usage:",
    "  litopencode install [--dry-run] [--root <dir>] --provider <openai|xai> --model <id> [--effort <e>] [--subagent-model <provider/id>] [--subagent-effort <e>] [--yolo]",
    "  litopencode install [--model-prompt | --no-model-prompt | --yes]",
    "  litopencode install [--permission-prompt | --no-permission-prompt] [--permission-mode <safe|balanced|yolo>]",
    "  litopencode install|doctor [--no-auto-update]",
    "  litopencode doctor [--json] [--root <dir>]",
    "  litopencode motion-runtime install|status [--audio] [--word-timing]",
    "  litopencode fetch-public <url> [--json] [--timeout <ms>] [--max-bytes <n>]",
    "  litopencode fetch-public <local-url> --json --allow-private-network  # trusted fixtures only",
    "  OpenCode /start-work init|resume|cancel|complete|status <schema-3 JSON>",
    "",
    "Evidence loop (all accept [--project <dir>] [--json]; default project is the current directory):",
    "  litopencode create-goals --session-id <id> --objective <text> [--title <t>] [--criterion <scenario>]... [--force]",
    "  litopencode status",
    "  litopencode record-evidence --criterion-id <id> --kind <red|green|scenario|cleanup|note> --ref <ref> [--detail <t>] [--status <s>]",
    "  litopencode checkpoint --summary <text> [--criterion-id <id>]",
    "  litopencode steer --directive <text> [--kind <redirect|add_criterion|narrow_scope|reprioritize|annotate>]",
    "  litopencode record-review-blockers --detail <text> [--needs-user-decision]",
    "  litopencode record-review-blockers --resolve <id>",
    "  litopencode complete-goals",
    "",
    "Commands:",
    "  install       Register litopencode with OpenCode using a branded installer UI.",
    "  doctor        Report package, config, and runtime path status without writing files.",
    "  fetch-public  Fetch a public URL with SSRF guards, verdicts, and trace output.",
    "                --allow-private-network is opt-in for reviewed local fixtures or trusted internal tests.",
    "",
    "Evidence ledger:",
    "  State lives in .litopencode/litgoal/lit-loop: goals.json is the machine state, brief.md is the",
    "  human-readable rendering, and ledger.jsonl stays the append-only audit trail. status is read-only and writes no files.",
    "  Mutating verbs write goals.json and brief.md, then append one ledger.jsonl audit event under the local mutation lock.",
    "  Criterion status: pending, in_progress, blocked, pass, fail. Evidence kinds: red, green, scenario, cleanup, note.",
    "  Goal status: active, blocked, review_blocked, needs_user_decision, complete.",
    "  A fresh --session-id opens new state beside the old; --force is required only to overwrite recorded evidence.",
    "  complete-goals refuses unless every criterion passes with green and scenario evidence and no blocker is open.",
    "  steer --kind add_criterion appends a pending criterion with the next safe C-number; it must pass before completion.",
    "  Other steering can redirect or annotate a goal; a directive that would weaken the completion gate is refused.",
    "",
    "Bounded authority:",
    "  /start-work owns a schema-3 bounded-authority lifecycle with CAS revisions and durable compaction.",
    "  Resume is accepted only from an exact trusted user route with the matching pending boundary grant.",
    "  Agent-callable tools cannot use resume as a generic authority bypass.",
    "",
    "Project-local knowledge:",
    "  The Wikify tool captures only structured fact, decision, failure, risk, rule, or checkpoint events.",
    "  New claims start review-needed in .litopencode/knowledge/claims.jsonl; save or review changes state.",
    "  Set knowledge.capture to false in .litopencode/config.json to disable capture. Query stays local and read-only.",
    "",
    "Native offline skills:",
    "  frontend-ui-ux provides deterministic design-contract retrieval from a packaged MIT corpus,",
    "                 plus sixteen shipped reference documents routed from its SKILL.md.",
    "  visual-qa validates evidence, PNGs, terminal layouts, and independent review receipts,",
    "            ships a per-channel capture playbook, and keeps blocked codes separate from fail codes.",
    "  lit-diagram-drawer creates conceptual, editorial, and technical diagrams with packaged type guides,",
    "                     local verifiers, bounded importers, and exports that never install tools.",
    "  lit-typographic-motion directs films from a treatment: a captured stage page or the type engine.",
    "  Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.",
    "  Each skill resolves its own helpers inside its own installed tree; these skills add no command,",
    "  MCP, agent, authentication, or write authority.",
    "",
    "Model routing:",
    "  Interactive terminal installs ask provider (openai | xai), LEAD model (planning/review) and HELPER model (execution/research),",
    "  preselecting the current managed route; --yes and --no-model-prompt keep the current non-picker behavior.",
    "  openai rows: " + openaiModelHelpLine() + ".",
    "  " + legacyFastAliasHelp(),
    "  xai rows: reasoning-capable Grok models from the host catalog, grok-4.6 first; XAI_API_KEY is warned about, never required.",
    "  --provider <p> --model <id> [--effort <e>] writes the lead route; --subagent-model <provider/id> [--subagent-effort <e>] the helper route.",
    "  " + modelEffortHelp(),
    "  Without flags/reset, planning and review (including lit-loop) use Astra/xhigh; execution and research helpers use GPT-6 Luna/max.",
    "  --model-prompt forces the picker on any existing route (managed keys only); --no-model-prompt and --yes keep current model routes.",
    "",
    "Permission behavior:",
    "  Terminal installs can ask whether LitOpenCode should stay safe, use balanced automation, or use YOLO.",
    "  --permission-prompt forces the permission picker; --no-permission-prompt keeps safe defaults.",
    "  --permission-mode <safe|balanced|yolo> writes the selected permission behavior explicitly.",
    "  --yolo is shorthand for --permission-mode yolo and also allows external_directory; lit-plan stays deny-only.",
    "",
    "Automatic updates:",
    "  Packaged plugin startup and successful interactive install/doctor use a bounded exact-version foreground update barrier.",
    "  The transaction uses a separate lock, private backup, journal, receipt, and post-install doctor rollback.",
    "  --no-auto-update or LITOPENCODE_NO_AUTO_UPDATE=1 disables the barrier; NO_UPDATE_NOTIFIER and LITOPENCODE_NO_UPDATE_CHECK also disable it.",
    "  The detached update notice remains cache-refresh-only and never installs.",
    "",
    "Default root:",
    "  ~/.config/opencode, or $XDG_CONFIG_HOME/opencode when XDG_CONFIG_HOME is set."
  ].join("\n");
}

export async function runCli(argv: readonly string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<CliResult> {
  if (argv[0] === "motion-runtime") {
    const metadata = await readPackageMetadata();
    return runMotionRuntime(metadata.packageRoot, argv.slice(1));
  }
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, stderr: message };
  }

  try {
    if (!parsed.command || parsed.command === "help") {
      return { exitCode: 0, stdout: helpText() };
    }
    if (isLoopCommand(parsed.command)) return await runLoopCommand(parsed.command, parsed.loop);
    if (parsed.command === "doctor") return await doctor(parsed.root);
    if (parsed.command === "fetch-public") {
      if (!parsed.fetchPublicUrl) return { exitCode: 2, stderr: "fetch-public requires a URL" };
      const output = await fetchPublicSource(parsed.fetchPublicUrl, {
        allowPrivateNetwork: parsed.fetchPublicAllowPrivateNetwork,
        timeoutMs: parsed.fetchPublicTimeoutMs,
        maxBytes: parsed.fetchPublicMaxBytes
      });
      if (parsed.fetchPublicJson) return { exitCode: output.ok ? 0 : 1, stdout: JSON.stringify(output, null, 2) };
      return { exitCode: output.ok ? 0 : 1, stdout: renderFetchPublicText(output) };
    }
    if (parsed.command === "install") {
      return await install(
        parsed.root,
        parsed.dryRun,
        parsed.modelSelection,
        parsed.modelPrompt,
        parsed.permissionMode,
        parsed.permissionModeExplicit,
        parsed.permissionPrompt,
        options.installProgress,
        parsed.outputStylePrompt
      );
    }
    return { exitCode: 2, stderr: `Unknown command: ${parsed.command}` };
  } catch (error) {
    await options.installProgress?.fail("Installer stopped before completion.");
    const prefix = error instanceof LitOpenCodeConfigError ? "CONFIG_ERROR" : "ERROR";
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stderr: `${prefix}: ${message}` };
  }
}

function renderFetchPublicText(output: Awaited<ReturnType<typeof fetchPublicSource>>): string {
  return [
    `verdict: ${output.verdict}`,
    `ok: ${String(output.ok)}`,
    output.finalUrl ? `finalUrl: ${output.finalUrl}` : undefined,
    output.status ? `status: ${output.status}` : undefined,
    output.reason ? `reason: ${output.reason}` : undefined,
    output.content ? "" : undefined,
    output.content
  ].filter((line): line is string => line !== undefined).join("\n");
}

function shouldPrintCommandWordmark(argv: readonly string[]): boolean {
  if (argv.includes("--json")) return false;
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === "install" || parsed.command === "doctor") return false;
    return parsed.command === "help" || parsed.command === "fetch-public" || isLoopCommand(parsed.command);
  } catch {
    return false;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const result = await runCli(argv, { installProgress: shouldRenderInstallTui(argv) ? createInstallTui() : undefined });
  if (shouldPrintCommandWordmark(argv)) {
    const metadata = await readPackageMetadata();
    const colorEnabled = process.stdout.isTTY === true && process.env.CI === undefined && process.env.NO_COLOR === undefined;
    process.stdout.write(`${renderLitOpenCodeWordmark(metadata.name + "@" + metadata.version, colorEnabled)}\n`);
  }
  // Doctor's stdout is JSON even without --json; keep its interactive mark on stderr.
  if (argv[0] === "doctor" && !argv.some((arg) => arg === "--json" || arg === "--help" || arg === "-h") && process.stderr.isTTY === true && process.env.CI === undefined) {
    const metadata = await readPackageMetadata();
    process.stderr.write(`${renderLitOpenCodeWordmark(metadata.name + "@" + metadata.version)}\n`);
  }
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  let autoUpdateResult: Awaited<ReturnType<typeof runInteractiveAutoUpdate>>;
  try {
    autoUpdateResult = await runInteractiveAutoUpdate({
      argv,
      exitCode: result.exitCode,
      env: process.env,
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
      stderrIsTTY: process.stderr.isTTY,
      configRoot: (() => {
        try {
          return parseArgs(argv).root;
        } catch {
          return undefined;
        }
      })()
    });
  } catch (error) {
    process.stderr.write(`Automatic update stopped before verification: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (!canContinueAfterAutoUpdate(autoUpdateResult)) {
    process.stderr.write(`${autoUpdateDiagnostic(autoUpdateResult)}\n`);
    process.exitCode = 1;
    return;
  }
  await runUpdateNotifier({
    argv,
    exitCode: result.exitCode,
    env: process.env,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    stderrIsTTY: process.stderr.isTTY
  });
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
