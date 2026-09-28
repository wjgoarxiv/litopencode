import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { markColorMode } from "../lit-mark.ts";
import { isRecord } from "./json.ts";
import {
  isModelProvider,
  modelMenuRows,
  providerCredentialEnv,
  providerMenu,
  stripFastSuffix,
  type ModelMenuRow,
  type ModelProvider
} from "./model-catalog.ts";
import type {
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

type PromptReader = {
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

function createPromptReader(): PromptReader {
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

async function chooseProvider(reader: PromptReader, title: string, defaultProvider: ModelProvider): Promise<ModelProvider> {
  const defaultIndex = Math.max(0, providerMenu.findIndex((row) => row.provider === defaultProvider));
  const index = await chooseIndex(
    reader,
    title,
    providerMenu.map((row) => ({ label: row.label.padEnd(35, " ") + " (" + row.provider + ")", hint: "" })),
    defaultIndex
  );
  return providerMenu[index].provider;
}

async function chooseRoute(
  reader: PromptReader,
  title: string,
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
  if (
    preferred !== undefined &&
    row.provider === preferred.provider &&
    row.model === preferredModel
  ) {
    return preferred;
  }
  return { provider: row.provider, model: row.model, effort: row.effort };
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

export function renderModelRouteCard(selection: InstallModelSelection, configPath: string): string {
  const helper = selection.helper ?? selection;
  const providers = helper.provider === selection.provider ? selection.provider : selection.provider + " / " + helper.provider;
  const warnings = [...new Set([selection.provider, helper.provider])]
    .filter((provider) => !hasProviderCredential(provider))
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
    "╰─ Enter to continue · Ctrl-C to abort (nothing written yet)"
  ].join("\n") + "\n";
}

export async function promptModelSelection(
  selection: InstallModelSelection | undefined,
  mode: ModelPromptMode,
  dryRun: boolean,
  classification: ModelConfigClassification,
  configPath: string,
  currentSelection: InstallModelSelection | undefined = undefined
): Promise<InstallModelSelection | undefined> {
  if (!shouldPromptForModel(mode, selection, dryRun, classification, currentSelection)) {
    if (selection !== undefined && !dryRun) process.stdout.write(renderModelRouteCard(selection, configPath));
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
    const leadProvider = await chooseProvider(
      reader,
      "Choose the provider for LitOpenCode agents.",
      preferredSelection !== undefined && isModelProvider(preferredSelection.provider) ? preferredSelection.provider : "openai"
    );
    const lead = await chooseRoute(
      reader,
      "Choose the LEAD model (plans and reviews).",
      leadProvider,
      0,
      preferredSelection
    );
    const preferredHelper = preferredSelection?.helper;
    const helperProvider = await chooseProvider(
      reader,
      "Choose the provider for HELPER agents (workers, explorers, librarians).",
      preferredHelper !== undefined && isModelProvider(preferredHelper.provider) ? preferredHelper.provider : leadProvider
    );
    const helper = await chooseRoute(
      reader,
      "Choose the HELPER model (spawned and delegated agents).",
      helperProvider,
      recommendedHelperIndex(helperProvider),
      preferredHelper
    );
    const chosen: InstallModelSelection = { ...lead, helper };
    process.stdout.write(renderModelRouteCard(chosen, configPath));
    await askLine(reader, "");
    return chosen;
  } finally {
    reader.close();
  }
}
