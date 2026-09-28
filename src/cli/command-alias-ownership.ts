import fs from "node:fs/promises";
import path from "node:path";
import { hasLitOpenCodeGeneratedFileMarker } from "../user-facing-markdown.ts";

export type CommandAliasOwnership = "missing" | "managed" | "preserved";

export async function commandAliasOwnership(root: string, id: string): Promise<CommandAliasOwnership> {
  try {
    const existing = await fs.readFile(path.join(root, "command", id + ".md"), "utf8");
    return hasLitOpenCodeGeneratedFileMarker(existing) ? "managed" : "preserved";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}
