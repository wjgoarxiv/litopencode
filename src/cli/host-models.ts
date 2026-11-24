// The models OpenCode itself knows, so a user can pick any provider they set up there, including a
// custom OpenAI-compatible one. OpenCode 1 lists them with `opencode models` (one `provider/model` per
// line, custom providers included). OpenCode 2's `models` needs a running server, so the provider
// blocks in the config files are read as well: OpenCode 1 writes `provider`, OpenCode 2 `providers`.
import { execFile, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { isRecord } from "./json.ts";
import { parseJsonc } from "./jsonc.ts";

export type HostModel = { readonly provider: string; readonly model: string };

export type HostModelList = {
  readonly models: readonly HostModel[];
  /** True only when OpenCode itself answered `models`; config files alone list just the providers declared there. */
  readonly known: boolean;
};

export type ModelListing = "listed" | "unlisted" | "unchecked";

/**
 * Whether `wanted` can be checked against the list. Without OpenCode's own answer only the providers a
 * config file declares can be checked (their model list is the user's own); any other provider is unchecked.
 */
export function modelListing(wanted: HostModel, list: HostModelList): ModelListing {
  if (list.models.some((model) => hostModelKey(model) === hostModelKey(wanted))) return "listed";
  if (list.known || list.models.some((model) => model.provider === wanted.provider)) return "unlisted";
  return "unchecked";
}

const modelIdPattern = /^[A-Za-z0-9][\w.@:+-]*\/\S+$/u;
const configFileNames = ["opencode.json", "opencode.jsonc", "config.json"] as const;
const hostCommandTimeoutMs = 60_000;

export function hostModelKey(model: HostModel): string {
  return model.provider + "/" + model.model;
}

function uniqueModels(models: readonly HostModel[]): readonly HostModel[] {
  const seen = new Set<string>();
  const unique: HostModel[] = [];
  for (const model of models) {
    const key = hostModelKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(model);
  }
  return unique;
}

export function splitModelId(value: string): HostModel | undefined {
  const trimmed = value.trim();
  if (!modelIdPattern.test(trimmed)) return undefined;
  const slash = trimmed.indexOf("/");
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

export function parseHostModelLines(text: string): readonly HostModel[] {
  return uniqueModels(
    text
      .split(/\r?\n/u)
      .map((line) => splitModelId(line))
      .filter((model): model is HostModel => model !== undefined)
  );
}

export function configuredProviderModels(config: unknown): readonly HostModel[] {
  if (!isRecord(config)) return [];
  const models: HostModel[] = [];
  for (const key of ["provider", "providers"] as const) {
    const providers = config[key];
    if (!isRecord(providers)) continue;
    for (const [provider, entry] of Object.entries(providers)) {
      if (!isRecord(entry) || !isRecord(entry.models)) continue;
      for (const model of Object.keys(entry.models)) models.push({ provider, model });
    }
  }
  return uniqueModels(models);
}

function readConfigModels(root: string): readonly HostModel[] {
  const models: HostModel[] = [];
  for (const name of configFileNames) {
    let text: string;
    try {
      text = fsSync.readFileSync(path.join(root, name), "utf8");
    } catch {
      continue;
    }
    try {
      models.push(...configuredProviderModels(parseJsonc(text)));
    } catch {
      // A config OpenCode cannot parse either adds nothing here; the host command still may.
    }
  }
  return models;
}

function runHostModels(command: string): readonly HostModel[] | undefined {
  const result = spawnSync(command, ["models"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: hostCommandTimeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === "win32"
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
  const models = parseHostModelLines(result.stdout);
  return models.length === 0 ? undefined : models;
}

export type ListHostModelsOptions = {
  readonly root: string;
  /** Host command to ask (`opencode`); undefined reads the config files only. */
  readonly command?: string;
  readonly run?: (command: string) => readonly HostModel[] | undefined;
};

export function listHostModels(options: ListHostModelsOptions): HostModelList {
  const fromHost = options.command === undefined ? undefined : (options.run ?? runHostModels)(options.command);
  const fromConfig = readConfigModels(options.root);
  const models = uniqueModels([...(fromHost ?? []), ...fromConfig]);
  return { models, known: fromHost !== undefined };
}

function runHostModelsAsync(command: string): Promise<readonly HostModel[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["models"],
      { encoding: "utf8", timeout: hostCommandTimeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: process.platform === "win32" },
      (error, stdout) => {
        if (error !== null || typeof stdout !== "string") return resolve(undefined);
        const models = parseHostModelLines(stdout);
        resolve(models.length === 0 ? undefined : models);
      }
    ).stdin?.end();
  });
}

/** The same list without blocking the caller; the OpenCode plugin process must keep running meanwhile. */
export async function listHostModelsAsync(options: { readonly root: string; readonly command?: string }): Promise<HostModelList> {
  const fromHost = options.command === undefined ? undefined : await runHostModelsAsync(options.command);
  const models = uniqueModels([...(fromHost ?? []), ...readConfigModels(options.root)]);
  return { models, known: fromHost !== undefined };
}

export function providersOf(models: readonly HostModel[]): readonly string[] {
  return [...new Set(models.map((model) => model.provider))];
}

/** Up to `limit` known ids that share the provider, or failing that the model name, with `wanted`. */
export function closeModelMatches(wanted: HostModel, models: readonly HostModel[], limit = 10): readonly string[] {
  const sameProvider = models.filter((model) => model.provider === wanted.provider);
  const pool = sameProvider.length > 0 ? sameProvider : models.filter((model) => model.model.includes(wanted.model));
  return pool.slice(0, limit).map(hostModelKey);
}
