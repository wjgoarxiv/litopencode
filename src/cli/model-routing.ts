import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { markColorMode } from "../lit-mark.ts";
import { isRecord } from "./json.ts";
import { closeModelMatches, hostModelKey, modelListing, providersOf, splitModelId, type HostModelList } from "./host-models.ts";
import {
  isCustomRoute,
  isModelProvider,
  modelMenuRows,
  providerCredentialEnv,
  providerMenu,
  stripFastSuffix,
  type ModelMenuRow,
  type ModelProvider
} from "./model-catalog.ts";
import type {
  InstallModelEffort,
  InstallModelRoute,
  InstallModelSelection,
  InstallPermissionChoice,
  InstallPermissionMode,
  ModelConfigClassification,
  ModelPromptMode,
  PermissionPromptMode
} from "./types.ts";

const outputStyleOptions: readonly { readonly id: string; readonly label: string; readonly hint: string }[] = [
  { id: "off", label: "None / keep current", hint: "No output style applied" },
  { id: "asd-ste100", label: "ASD-STE100 (English)", hint: "ASD Simplified Technical English" },
  { id: "asd-ste100-ko", label: "ASD-STE100 (한국어)", hint: "ASD 간소화 기술 영어 (한국어)" },
  { id: "eli5", label: "ELI5 (English)", hint: "Explain Like I'm 5" },
  { id: "eli5-ko", label: "ELI5 (한국어)", hint: "쉽게 설명하기" }
];

function shouldPromptForInstallChoice(mode: PermissionPromptMode, dryRun: boolean): boolean {
  if (dryRun) return false;
  if (mode === "never") return false;
  if (mode === "always") return true;
  return process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.CI === undefined;
}

export async function promptOutputStyle(existing: string, promptMode: PermissionPromptMode, dryRun: boolean): Promise<string> {
  if (!shouldPromptForInstallChoice(promptMode, dryRun)) return existing;

  const defaultIndex = Math.max(0, outputStyleOptions.findIndex((opt) => opt.id === existing));
  const reader = createPromptReader();
  try {
    const index = await chooseIndex(reader, "Choose an output style for LitOpenCode responses.", outputStyleOptions, defaultIndex);
    return outputStyleOptions[index].id;
  } finally {
    reader.close();
  }
}

export type PromptReader = {
  question(prompt: string): Promise<string>;
  close(): void;
};

const permissionOptions: readonly { readonly mode: InstallPermissionMode; readonly label: string; readonly hint: string }[] = [
  {
    mode: "safe",
    label: "Safe / ask-first",
    hint: "Do not relax OpenCode permissions"
  },
  {
    mode: "balanced",
    label: "Balanced automation",
    hint: "Allow routine work but ask for dangerous shell commands such as rm -rf"
  },
  {
    mode: "yolo",
    label: "Full automation / YOLO",
    hint: "Allow bash/edit/task/webfetch; lit-plan remains deny-only"
  }
];

function formatChoice(index: number, label: string, hint: string): string {
  return "   " + String(index) + ". " + label + (hint.length === 0 ? "" : "   — " + hint);
}

async function askLine(reader: PromptReader, prompt: string): Promise<string> {
  return (await reader.question(prompt)).trim();
}

export function createPromptReader(): PromptReader {
  if (process.stdin.isTTY === true) {
    return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: markColorMode() !== "none" });
  }

  const answers = fsSync.readFileSync(0, "utf8").split(/\r?\n/u);
  let index = 0;
  return {
    async question(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const answer = answers[index] ?? "";
      index += 1;
      return answer;
    },
    close(): void {}
  };
}

async function chooseIndex(
  reader: PromptReader,
  title: string,
  choices: readonly { readonly label: string; readonly hint: string }[],
  defaultIndex: number
): Promise<number> {
  process.stdout.write("\n" + title + "\n");
  for (const [index, choice] of choices.entries()) {
    process.stdout.write(formatChoice(index, choice.label, choice.hint) + "\n");
  }
  const answer = await askLine(
    reader,
    "Select 0-" + String(choices.length - 1) + " [" + String(defaultIndex) + "]: "
  );
  if (answer.length === 0) return defaultIndex;
  const selected = Number.parseInt(answer, 10);
  if (/^\d+$/u.test(answer) && Number.isInteger(selected) && selected >= 0 && selected < choices.length) return selected;
  throw new Error("Invalid selection: " + answer);
}

function shouldPromptForModel(
  mode: ModelPromptMode,
  selection: InstallModelSelection | undefined,
  dryRun: boolean,
  classification: ModelConfigClassification,
  currentSelection: InstallModelSelection | undefined
): boolean {
  if (selection !== undefined || dryRun) return false;
  if (mode === "never") return false;
  if (mode === "always") return true;
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true || process.env.CI !== undefined) return false;
  return classification.class === "fresh" || classification.class === "managed_legacy" || currentSelection !== undefined;
}

function shouldPromptForPermissions(mode: PermissionPromptMode, selected: InstallPermissionMode, dryRun: boolean): boolean {
  return selected === "safe" && shouldPromptForInstallChoice(mode, dryRun);
}

export async function promptPermissionMode(
  selected: InstallPermissionMode,
  mode: PermissionPromptMode,
  dryRun: boolean
): Promise<InstallPermissionChoice> {
  if (!shouldPromptForPermissions(mode, selected, dryRun)) return { mode: selected, explicit: selected !== "safe" };

  const reader = createPromptReader();
  try {
    const index = await chooseIndex(reader, "Choose LitOpenCode permission behavior.", permissionOptions, 0);
    return { mode: permissionOptions[index].mode, explicit: true };
  } finally {
    reader.close();
  }
}

function menuLabel(row: ModelMenuRow): string {
  return row.model.padEnd(13, " ") + " · " + row.effort.padEnd(6, " ");
}

type ProviderChoice =
  | { readonly kind: "menu"; readonly provider: ModelProvider }
  | { readonly kind: "custom"; readonly provider: string }
  | { readonly kind: "typed" };

const typedRouteLabel = "Type provider/model";

// OpenAI and xAI first, then every other provider OpenCode knows (custom ones included), then a free entry.
async function chooseProvider(
  reader: PromptReader,
  title: string,
  defaultProvider: string,
  hostModels: HostModelList
): Promise<ProviderChoice> {
  const custom = providersOf(hostModels.models).filter((provider) => !isModelProvider(provider));
  // The current custom provider stays offered (and the default) even when OpenCode's list could not be read.
  if (!isModelProvider(defaultProvider) && !custom.includes(defaultProvider)) custom.push(defaultProvider);
  const choices: ProviderChoice[] = [
    ...providerMenu.map((row): ProviderChoice => ({ kind: "menu", provider: row.provider })),
    ...custom.map((provider): ProviderChoice => ({ kind: "custom", provider })),
    { kind: "typed" }
  ];
  const labels = choices.map((choice) => {
    if (choice.kind === "typed") return { label: typedRouteLabel, hint: "any model OpenCode can run" };
    if (choice.kind === "custom") {
      const count = hostModels.models.filter((model) => model.provider === choice.provider).length;
      return { label: choice.provider.padEnd(35, " ") + " (" + String(count) + (count === 1 ? " model)" : " models)"), hint: "" };
    }
    const row = providerMenu.find((candidate) => candidate.provider === choice.provider);
    return { label: (row?.label ?? choice.provider).padEnd(35, " ") + " (" + choice.provider + ")", hint: "" };
  });
  const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.kind !== "typed" && choice.provider === defaultProvider));
  return choices[await chooseIndex(reader, title, labels, defaultIndex)];
}

async function chooseCustomRoute(
  reader: PromptReader,
  title: string,
  role: string,
  provider: string,
  hostModels: HostModelList,
  preferred: InstallModelRoute | undefined
): Promise<InstallModelRoute> {
  const listed = hostModels.models.filter((model) => model.provider === provider);
  const keepPreferred = preferred !== undefined && preferred.provider === provider && !listed.some((model) => model.model === preferred.model);
  const models = keepPreferred ? [...listed, { provider, model: preferred.model }] : listed;
  if (models.length === 0) return typeRoute(reader, role, hostModels);
  const preferredIndex = preferred === undefined ? -1 : models.findIndex((model) => model.model === preferred.model && preferred.provider === provider);
  const index = await chooseIndex(
    reader,
    title,
    models.map((model) => ({ label: model.model, hint: "" })),
    Math.max(0, preferredIndex)
  );
  return { provider, model: models[index].model };
}

async function typeRoute(reader: PromptReader, role: string, hostModels: HostModelList): Promise<InstallModelRoute> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await askLine(reader, "Type the " + role + " model as provider/model (for example my-gateway/deepseek-chat): ");
    const wanted = splitModelId(answer);
    if (wanted === undefined) {
      process.stdout.write("Use provider/model, with the provider name OpenCode shows.\n");
      continue;
    }
    const knownRow = isModelProvider(wanted.provider)
      ? modelMenuRows(wanted.provider).find((row) => row.model === (wanted.provider === "openai" ? stripFastSuffix(wanted.model) : wanted.model))
      : undefined;
    if (knownRow !== undefined) return { provider: wanted.provider, model: wanted.model, effort: knownRow.effort };
    if (!isModelProvider(wanted.provider) && modelListing(wanted, hostModels) !== "unlisted") return wanted;
    const matches = isModelProvider(wanted.provider)
      ? modelMenuRows(wanted.provider).map((row) => row.provider + "/" + row.model)
      : closeModelMatches(wanted, hostModels.models);
    process.stdout.write(
      "OpenCode does not list " + hostModelKey(wanted) + "." + (matches.length > 0 ? " Known: " + matches.join(", ") : "") + "\n"
    );
  }
  throw new Error("No usable " + role + " model was typed; nothing was written.");
}

// After a model, the role's effort: every effort the host offers for that model, the
// recommended one marked, and the current route's effort as the default when it is still offered.
async function chooseEffort(reader: PromptReader, role: string, row: ModelMenuRow, current: InstallModelEffort | undefined): Promise<InstallModelEffort> {
  const preferred = current !== undefined && row.efforts.includes(current) ? current : row.effort;
  const index = await chooseIndex(
    reader,
    "Choose the " + role + " reasoning effort for " + row.model + ".",
    row.efforts.map((effort) => ({ label: effort, hint: effort === row.effort ? "recommended" : "" })),
    Math.max(0, row.efforts.indexOf(preferred))
  );
  return row.efforts[index];
}

async function chooseRoute(
  reader: PromptReader,
  title: string,
  role: string,
  provider: ModelProvider,
  defaultIndex: number,
  preferred: InstallModelRoute | undefined
): Promise<InstallModelRoute> {
  const rows = modelMenuRows(provider);
  const preferredModel = preferred === undefined ? undefined : provider === "openai" ? stripFastSuffix(preferred.model) : preferred.model;
  const preferredIndex = preferredModel === undefined ? -1 : rows.findIndex((row) => row.model === preferredModel);
  const selectedDefault = preferredIndex >= 0 ? preferredIndex : Math.min(defaultIndex, rows.length - 1);
  const index = await chooseIndex(
    reader,
    title,
    rows.map((row) => ({ label: menuLabel(row), hint: row.hint })),
    selectedDefault
  );
  const row = rows[index];
  const same = preferred !== undefined && row.provider === preferred.provider && row.model === preferredModel;
  const effort = await chooseEffort(reader, role, row, same ? preferred.effort : undefined);
  // An existing route keeps its exact model id (a -fast alias included).
  return same ? { ...preferred, effort } : { provider: row.provider, model: row.model, effort };
}

async function pickRoute(
  reader: PromptReader,
  title: string,
  role: string,
  choice: ProviderChoice,
  defaultIndex: number,
  preferred: InstallModelRoute | undefined,
  hostModels: HostModelList
): Promise<InstallModelRoute> {
  if (choice.kind === "menu") return chooseRoute(reader, title, role, choice.provider, defaultIndex, preferred);
  if (choice.kind === "custom") return chooseCustomRoute(reader, title, role, choice.provider, hostModels, preferred);
  return typeRoute(reader, role, hostModels);
}

function recommendedHelperIndex(provider: ModelProvider): number {
  return Math.max(0, modelMenuRows(provider).findIndex((row) => row.hint.includes("recommended helper")));
}

function hostAuthPath(): string {
  const dataHome = process.env.XDG_DATA_HOME;
  const base = dataHome && dataHome.length > 0 ? dataHome : path.join(os.homedir(), ".local", "share");
  return path.join(base, "opencode", "auth.json");
}

function hasProviderCredential(provider: string): boolean {
  const envName = providerCredentialEnv(provider);
  if (envName !== undefined && (process.env[envName] ?? "").length > 0) return true;
  try {
    const parsed: unknown = JSON.parse(fsSync.readFileSync(hostAuthPath(), "utf8"));
    return isRecord(parsed) && isRecord(parsed[provider]);
  } catch {
    return false;
  }
}

function routeLabel(route: InstallModelRoute): string {
  return route.model + " · " + (route.effort ?? "default");
}

/**
 * A custom route must name a model OpenCode lists. Throws with the close matches when the host list is
 * known and lacks it; returns a note per route that could not be checked.
 */
export function checkCustomRoutes(selection: InstallModelSelection, hostModels: () => HostModelList): readonly string[] {
  const routes = [selection, ...(selection.helper === undefined ? [] : [selection.helper])].filter(isCustomRoute);
  if (routes.length === 0) return [];
  const list = hostModels();
  const notes: string[] = [];
  for (const route of routes) {
    const key = hostModelKey(route);
    const listing = modelListing(route, list);
    if (listing === "unchecked") {
      notes.push("│ Note       OpenCode's model list could not be read, so " + key + " was not checked");
      continue;
    }
    if (listing === "listed") continue;
    const matches = closeModelMatches(route, list.models);
    throw new Error(
      "OpenCode does not list the model " + key + "; nothing was written." +
        (matches.length > 0 ? " Known " + route.provider + " models: " + matches.join(", ") + "." : " Add the provider to OpenCode first; `opencode models` shows what it can run.")
    );
  }
  return [...new Set(notes)];
}

export function renderModelRouteCard(selection: InstallModelSelection, configPath: string, notes: readonly string[] = []): string {
  const helper = selection.helper ?? selection;
  const providers = helper.provider === selection.provider ? selection.provider : selection.provider + " / " + helper.provider;
  // Custom providers keep their key in OpenCode's own provider config, so only the menu providers are checked.
  const warnings = [...new Set([selection.provider, helper.provider])]
    .filter((provider) => isModelProvider(provider) && !hasProviderCredential(provider))
    .map((provider) => {
      const envName = providerCredentialEnv(provider) ?? provider.toUpperCase() + "_API_KEY";
      return "│ Warning    " + envName + " is not set and OpenCode has no stored " + provider + " credential; the route is written anyway";
    });
  return [
    "",
    "╭─ MODEL ROUTE",
    "│ Provider   " + providers,
    "│ Lead       " + routeLabel(selection),
    "│ Helpers    " + routeLabel(helper),
    "│ Writes     " + configPath + "  (managed keys only)",
    ...warnings,
    ...notes,
    "╰─ Enter to continue · Ctrl-C to abort (nothing written yet)"
  ].join("\n") + "\n";
}

export async function promptModelSelection(
  selection: InstallModelSelection | undefined,
  mode: ModelPromptMode,
  dryRun: boolean,
  classification: ModelConfigClassification,
  configPath: string,
  currentSelection: InstallModelSelection | undefined = undefined,
  hostModels: () => HostModelList = () => ({ models: [], known: false })
): Promise<InstallModelSelection | undefined> {
  if (!shouldPromptForModel(mode, selection, dryRun, classification, currentSelection)) {
    if (selection !== undefined) {
      const notes = checkCustomRoutes(selection, hostModels);
      if (!dryRun) process.stdout.write(renderModelRouteCard(selection, configPath, notes));
    }
    return selection;
  }

  const preferredSelection = mode === "auto" ? currentSelection : undefined;
  const reader = createPromptReader();
  try {
    if (classification.class === "managed_legacy") {
      process.stdout.write("\nManaged GPT-5.4/GPT-5.5 route detected; choosing a route upgrades it.\n");
    } else if (classification.class !== "fresh") {
      process.stdout.write("\nExisting route (" + classification.class + ") will be rewritten in managed keys only.\n");
    }
    const models = hostModels();
    const leadProvider = await chooseProvider(
      reader,
      "Choose the provider for LitOpenCode agents.",
      preferredSelection?.provider ?? "openai",
      models
    );
    const lead = await pickRoute(reader, "Choose the LEAD model (plans and reviews).", "LEAD", leadProvider, 0, preferredSelection, models);
    const preferredHelper = preferredSelection?.helper;
    const helperProvider = await chooseProvider(
      reader,
      "Choose the provider for HELPER agents (workers, explorers, librarians).",
      preferredHelper?.provider ?? lead.provider,
      models
    );
    const helper = await pickRoute(
      reader,
      "Choose the HELPER model (spawned and delegated agents).",
      "HELPER",
      helperProvider,
      helperProvider.kind === "menu" ? recommendedHelperIndex(helperProvider.provider) : 0,
      preferredHelper,
      models
    );
    const chosen: InstallModelSelection = { ...lead, helper };
    process.stdout.write(renderModelRouteCard(chosen, configPath, checkCustomRoutes(chosen, () => models)));
    await askLine(reader, "");
    return chosen;
  } finally {
    reader.close();
  }
}
