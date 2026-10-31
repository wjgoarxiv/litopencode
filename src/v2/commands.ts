// Lit slash commands on OpenCode 2. The installer writes one markdown alias file per command
// (`command/<id>.md`), and OpenCode 2 lets such a file replace a plugin command of the same name, so the
// alias files are the source of every lit command on both hosts. The plugin adds a command only when no
// alias file covers it, for example when the package was added with `opencode plugin` and the installer
// never ran. A command the plugin sends carries a one-time nonce in the user message metadata; the
// prompt hook accepts the command mark only with that nonce, so a typed or forged mark is dropped. A
// command with an agent route (the `agent:` line of its alias file) first switches the session to that
// agent, so `/lit-crucible` really runs in the planning-only `lit-plan`.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { litOpenCodeCommands } from "../commands.ts";

export type CommandInvocationLike = {
  readonly sessionID: string;
  readonly prompt: { readonly text: string };
  readonly delivery: "steer" | "queue";
};

export type CommandDefinitionLike = {
  readonly name: string;
  readonly description?: string;
  readonly execute: (input: CommandInvocationLike) => Promise<void>;
};

export type CommandEditorLike = { add(definition: CommandDefinitionLike): void };

export type CommandSessionLike = {
  readonly switchAgent: (input: { readonly sessionID: string; readonly agent: string }) => Promise<unknown>;
  readonly prompt: (input: {
    readonly sessionID: string;
    readonly text: string;
    readonly delivery?: "steer" | "queue";
    readonly metadata?: { readonly litopencode: { readonly command: string; readonly banner: string; readonly nonce: string } };
  }) => Promise<unknown>;
};

const aliasDirectories = ["command", "commands"] as const;

function hasAliasFile(roots: readonly string[], id: string): boolean {
  return roots.some((root) => aliasDirectories.some((directory) => fs.existsSync(path.join(root, directory, `${id}.md`))));
}

/** Lit command ids that no alias file covers in the given command roots. */
export function pluginOwnedCommandIds(roots: readonly string[]): readonly string[] {
  return litOpenCodeCommands.map((command) => command.id).filter((id) => !hasAliasFile(roots, id));
}

export type CommandMark = { readonly command: string; readonly banner: string; readonly work?: string };

export function createV2Commands(roots: readonly string[], session: CommandSessionLike) {
  const owned = new Set(pluginOwnedCommandIds(roots));
  const pending = new Map<string, { readonly nonce: string; readonly mark: CommandMark; readonly work: string }>();

  const definitions: CommandDefinitionLike[] = litOpenCodeCommands
    .filter((command) => owned.has(command.id))
    .map((command) => ({
      name: command.id,
      description: `${command.title} - ${command.description}`,
      async execute(input) {
        const nonce = randomUUID();
        const mark = { command: command.id, banner: command.banner };
        const argumentsText = input.prompt.text.trim();
        pending.set(input.sessionID, { nonce, mark, work: argumentsText });
        if (command.agent !== undefined) await session.switchAgent({ sessionID: input.sessionID, agent: command.agent });
        await session.prompt({
          sessionID: input.sessionID,
          text: argumentsText === "" ? command.activationText : `${command.activationText}\n\n${argumentsText}`,
          delivery: input.delivery,
          metadata: { litopencode: { ...mark, nonce } }
        });
      }
    }));

  /**
   * Checks a command mark at admission. Returns the mark when the plugin sent it for this session (and
   * consumes the nonce), and undefined otherwise; the caller then removes the mark from the metadata.
   */
  function acceptMark(sessionID: string, marker: unknown): CommandMark | undefined {
    if (typeof marker !== "object" || marker === null) return undefined;
    const expected = pending.get(sessionID);
    if (expected === undefined || (marker as { nonce?: unknown }).nonce !== expected.nonce) return undefined;
    pending.delete(sessionID);
    return { ...expected.mark, work: expected.work };
  }

  return {
    definitions,
    acceptMark,
    add(editor: CommandEditorLike): void {
      for (const definition of definitions) editor.add(definition);
    }
  };
}
