import fs from "node:fs/promises";
import path from "node:path";

export async function listTopLevelSkillIds() {
  const entries = await fs.readdir("skills", { withFileTypes: true });
  const skillIds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const stat = await fs.stat(path.join("skills", entry.name, "SKILL.md"));
      if (stat.isFile()) skillIds.push(entry.name);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return skillIds.sort((left, right) => left.localeCompare(right));
}
