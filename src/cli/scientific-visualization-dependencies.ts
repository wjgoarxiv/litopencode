import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const requiredModules = Object.freeze(["matplotlib"] as const);
const optionalModules = Object.freeze([
  "numpy",
  "seaborn",
  "pandas",
  "plotly",
  "scipy",
  "colorspacious",
  "MDAnalysis",
  "kaleido"
] as const);

type ModuleAvailability = Readonly<Record<string, boolean>>;

export type ScientificVisualizationDependencyReport = {
  readonly status: "READY" | "DEGRADED";
  readonly interpreter: {
    readonly command: string;
    readonly available: boolean;
    readonly version?: string;
  };
  readonly required: {
    readonly available: readonly string[];
    readonly missing: readonly string[];
  };
  readonly optional: {
    readonly available: readonly string[];
    readonly missing: readonly string[];
  };
  readonly autoInstall: false;
};

function selectedInterpreter(): string {
  const explicit = process.env.LITOPENCODE_SCIENTIFIC_PYTHON?.trim();
  return explicit && explicit.length > 0 ? explicit : "python3";
}

function unavailableReport(command: string): ScientificVisualizationDependencyReport {
  return {
    status: "DEGRADED",
    interpreter: { command, available: false },
    required: { available: [], missing: [command, ...requiredModules] },
    optional: { available: [], missing: optionalModules },
    autoInstall: false
  };
}

function availableNames(names: readonly string[], modules: ModuleAvailability): string[] {
  return names.filter((name) => modules[name] === true);
}

function missingNames(names: readonly string[], modules: ModuleAvailability): string[] {
  return names.filter((name) => modules[name] !== true);
}

export function inspectScientificVisualizationDependencies(): ScientificVisualizationDependencyReport {
  const command = selectedInterpreter();
  const modules = [...requiredModules, ...optionalModules];
  const script = [
    "import importlib, json, platform",
    `modules = ${JSON.stringify(modules)}`,
    "def can_import(name):",
    "    try:",
    "        importlib.import_module(name)",
    "        return True",
    "    except Exception:",
    "        return False",
    "print(json.dumps({'version': platform.python_version(), 'modules': {name: can_import(name) for name in modules}}))"
  ].join("\n");
  const matplotlibConfig = mkdtempSync(path.join(tmpdir(), "litopencode-matplotlib-probe-"));
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(command, ["-c", script], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        MPLCONFIGDIR: matplotlibConfig,
        PYTHONDONTWRITEBYTECODE: "1"
      }
    });
  } finally {
    rmSync(matplotlibConfig, { recursive: true, force: true });
  }
  if (result.status !== 0 || result.error !== undefined) return unavailableReport(command);

  try {
    const parsed = JSON.parse(String(result.stdout)) as { readonly version?: unknown; readonly modules?: unknown };
    if (typeof parsed.version !== "string" || !parsed.modules || typeof parsed.modules !== "object") {
      return unavailableReport(command);
    }
    const availability = parsed.modules as ModuleAvailability;
    const requiredMissing = missingNames(requiredModules, availability);
    return {
      status: requiredMissing.length === 0 ? "READY" : "DEGRADED",
      interpreter: { command, available: true, version: parsed.version },
      required: {
        available: availableNames(requiredModules, availability),
        missing: requiredMissing
      },
      optional: {
        available: availableNames(optionalModules, availability),
        missing: missingNames(optionalModules, availability)
      },
      autoInstall: false
    };
  } catch {
    return unavailableReport(command);
  }
}
