import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved relative to the compiled output at dist/rules/output-style.js — two levels up reaches
// the package root, where output-styles/ lives (same resolution pattern as managed-skill-assets.ts
// uses for its manifest, and activation-prompt-utils.ts uses for skills/).
const outputStylesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../output-styles");

const validStyleIds = new Set(["asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"]);

export async function readOutputStyleText(styleId: string | undefined): Promise<string> {
  if (styleId === undefined || styleId === "" || styleId === "off") return "";
  if (!validStyleIds.has(styleId)) return "";
  try {
    return await fs.readFile(path.join(outputStylesDir, styleId + ".md"), "utf8");
  } catch {
    return "";
  }
}
