// `/lit-model`: pick the LitOpenCode lead and helper models from a numbered list of every model OpenCode
// knows, and save the pick to litopencode.json, the same managed keys the installer writes. Every new
// OpenCode session reads that file, so the choice holds in every terminal until it is changed again.
// The tool is model-callable, so it saves only models already on the list: a provider the user set up
// in OpenCode, or an OpenAI/xAI menu row. Anything else goes through the installer's `--model`.
import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeAgents } from "./agents/registry.ts";
import { listHostModelsAsync, hostModelKey, splitModelId, closeModelMatches, type HostModel, type HostModelList } from "./cli/host-models.ts";
import { isRecord } from "./cli/json.ts";
import { parseJsonc } from "./cli/jsonc.ts";
import { isModelProvider, modelMenuRows, stripFastSuffix } from "./cli/model-catalog.ts";
import { readInstallModelClassification, readInstallModelSelection, writeTextAtomically } from "./cli/install-config.ts";
import { selectedLitConfig } from "./cli/model-policy.ts";
import type { InstallModelRoute, InstallModelSelection } from "./cli/types.ts";
import { defaultOpenCodeConfigRoot, litOpenCodeConfigFileForOpenCodeRoot } from "./state.ts";

export type ModelPickResult = { readonly text: string; readonly changed: boolean };

export type ModelPickOptions = {
  readonly choice: string;
  readonly root?: string;
  readonly hostModels?: () => HostModelList | Promise<HostModelList>;
};

type Role = "both" | "lead" | "helper";

const shownLimit = 150;

function menuRoute(model: HostModel): InstallModelRoute | undefined {
  if (!isModelProvider(model.provider)) return undefined;
  const id = model.provider === "openai" ? stripFastSuffix(model.model) : model.model;
  const row = modelMenuRows(model.provider).find((candidate) => candidate.model === id);
  return row === undefined ? undefined : { provider: model.provider, model: model.model, effort: row.effort };
}

// OpenAI and xAI offer only their menu rows (the installer checks their efforts); every other provider
// OpenCode lists is offered as it is.
function pickList(host: HostModelList): readonly HostModel[] {
  const rows = (["openai", "xai"] as const).flatMap((provider) => modelMenuRows(provider).map((row) => ({ provider, model: row.model })));
  const seen = new Set<string>();
  const list: HostModel[] = [];
  for (const model of [...rows, ...host.models.filter((candidate) => !isModelProvider(candidate.provider))]) {
    const key = hostModelKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(model);
  }
  return list;
}

function routeLabel(route: InstallModelRoute | undefined): string {
  if (route === undefined) return "not set by LitOpenCode";
  return hostModelKey(route) + (route.effort === undefined ? "" : " · " + route.effort);
}

function routeFor(model: HostModel): InstallModelRoute {
  return menuRoute(model) ?? { provider: model.provider, model: model.model };
}

function parseChoice(choice: string): { readonly role: Role; readonly pick: string } | undefined {
  const words = choice.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 1) return words[0] === "lead" || words[0] === "helper" ? undefined : { role: "both", pick: words[0] };
  if (words.length === 2 && (words[0] === "lead" || words[0] === "helper")) return { role: words[0], pick: words[1] };
  return undefined;
}

function resolvePick(pick: string, list: readonly HostModel[]): HostModel | string {
  if (/^\d+$/u.test(pick)) {
    const index = Number.parseInt(pick, 10) - 1;
    return list[index] ?? "There is no model number " + pick + "; the list has 1-" + String(list.length) + ".";
  }
  const wanted = splitModelId(pick);
  if (wanted === undefined) return "Pick a number from the list, or a provider/model id from it.";
  const found = list.find((model) => hostModelKey(model) === hostModelKey(wanted));
  if (found !== undefined) return found;
  const matches = isModelProvider(wanted.provider)
    ? modelMenuRows(wanted.provider).map((row) => row.provider + "/" + row.model)
    : closeModelMatches(wanted, list);
  return (
    hostModelKey(wanted) + " is not on the list." + (matches.length > 0 ? " Known: " + matches.join(", ") + "." : "") +
    " To use a model OpenCode did not list, run: npm exec --package @litfamily/litopencode@latest -- litopencode install --model " + hostModelKey(wanted)
  );
}

async function readExisting(filePath: string): Promise<Record<string, unknown> | null | "malformed"> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "malformed";
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : "malformed";
  } catch {
    return "malformed";
  }
}

// A model set for a LitOpenCode agent in opencode.json wins over the pick for that agent (see the registry).
async function agentsWithOwnModel(root: string): Promise<readonly string[]> {
  const ids = new Set(litOpenCodeAgents.map((agent) => agent.id));
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    let config: unknown;
    try {
      config = parseJsonc(await fs.readFile(path.join(root, name), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(config) || !isRecord(config.agent)) return [];
    return Object.entries(config.agent)
      .filter(([id, value]) => ids.has(id) && isRecord(value) && typeof value.model === "string" && value.model.length > 0)
      .map(([id]) => id);
  }
  return [];
}

async function pickNotes(root: string, classification: string): Promise<readonly string[]> {
  const notes: string[] = [];
  if (classification === "custom") notes.push("Agents with their own route in litopencode.json keep it.");
  if (classification === "mixed") notes.push("The four model categories held different routes; the ones this pick covers now share it.");
  const own = await agentsWithOwnModel(root);
  if (own.length > 0) notes.push("opencode.json sets a model for " + own.join(", ") + "; that model still wins for those agents.");
  return notes;
}

export async function runModelPick(options: ModelPickOptions): Promise<ModelPickResult> {
  const root = options.root ?? defaultOpenCodeConfigRoot();
  const filePath = litOpenCodeConfigFileForOpenCodeRoot(root);
  const existing = await readExisting(filePath);
  let current: InstallModelSelection | undefined;
  let classification: string;
  try {
    if (existing === "malformed") throw new Error("malformed");
    current = await readInstallModelSelection(root);
    classification = (await readInstallModelClassification(root)).class;
  } catch {
    return { text: filePath + " cannot be read as a LitOpenCode config, so it was left alone. Fix or remove it, then run /lit-model again.", changed: false };
  }
  const host = await (options.hostModels ?? (() => listHostModelsAsync({ root, command: "opencode" })))();
  const list = pickList(host);
  const lead = current;
  const helper = current?.helper ?? current;

  if (options.choice.trim() === "") {
    const shown = list.slice(0, shownLimit);
    const lines = [
      "LitOpenCode models. Lead (plans, reviews): " + routeLabel(lead) + ". Helper (workers, research): " + routeLabel(helper) + ".",
      ...shown.map((model, index) => String(index + 1).padStart(3, " ") + ". " + hostModelKey(model)),
      ...(list.length > shown.length ? [String(list.length - shown.length) + " more are not shown; pick one by its provider/model id."] : []),
      "Pick one for both roles: /lit-model <number>. One role only: /lit-model lead <number> or /lit-model helper <number>.",
      host.known
        ? "The list is what OpenCode can run, providers you added included."
        : "OpenCode's own list could not be read, so the list holds the OpenAI and xAI rows and the providers in your OpenCode config."
    ];
    return { text: lines.join("\n"), changed: false };
  }

  const parsed = parseChoice(options.choice);
  if (parsed === undefined) return { text: "Use /lit-model, /lit-model <number>, /lit-model lead <number> or /lit-model helper <number>. Nothing was changed.", changed: false };
  const picked = resolvePick(parsed.pick, list);
  if (typeof picked === "string") return { text: picked + " Nothing was changed.", changed: false };

  const route = routeFor(picked);
  const nextLead = parsed.role === "helper" ? lead : route;
  const nextHelper = parsed.role === "lead" ? helper : route;
  if (nextLead === undefined) return { text: "Pick the lead model first: /lit-model lead <number>. Nothing was changed.", changed: false };
  const selection: InstallModelSelection = { ...nextLead, ...(nextHelper === undefined ? {} : { helper: nextHelper }) };
  const next = selectedLitConfig(existing, selection);
  try {
    await fs.mkdir(root, { recursive: true });
    await writeTextAtomically(filePath, JSON.stringify(next, null, 2) + "\n");
  } catch (error) {
    return { text: "Could not save " + filePath + ": " + (error instanceof Error ? error.message : String(error)) + ". Nothing was changed.", changed: false };
  }
  const notes = await pickNotes(root, classification);
  return {
    text: [
      "Saved in " + filePath + ". Lead: " + routeLabel(nextLead) + ". Helper: " + routeLabel(nextHelper ?? nextLead) + ". Restart OpenCode to use it; every new terminal starts with it.",
      ...notes
    ].join("\n"),
    changed: true
  };
}
