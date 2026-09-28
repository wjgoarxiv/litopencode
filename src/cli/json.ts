import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageMetadata } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readPackageMetadata(): Promise<PackageMetadata> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const packagePath = path.join(packageRoot, "package.json");
  const parsed: unknown = JSON.parse(await fs.readFile(packagePath, "utf8"));
  if (!isRecord(parsed) || typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`Malformed package metadata at ${packagePath}`);
  }
  return { name: parsed.name, version: parsed.version, packageRoot };
}

export async function readJsonObjectIfPresent(filePath: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`Malformed JSON at ${filePath}: expected an object.`);
  }
  return parsed;
}
