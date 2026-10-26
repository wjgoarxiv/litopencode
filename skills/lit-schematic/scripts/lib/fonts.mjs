// Locates fonts for rendering. Pretendard ships with the sibling lit-diagram-drawer skill
// (unmodified official file under the OFL); lit-schematic reads it from there instead of carrying
// a second copy. Both skills install side by side under one skills directory.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function findPretendard() {
  const sibling = join(SKILL_ROOT, "..", "lit-diagram-drawer", "assets", "fonts", "PretendardVariable.woff2");
  if (existsSync(sibling)) return { file: sibling, source: "skill" };
  const dirs = [join(homedir(), "Library", "Fonts"), "/Library/Fonts", join(homedir(), ".local", "share", "fonts"), "/usr/share/fonts", "C:\\Windows\\Fonts"];
  for (const dir of dirs) {
    try {
      const hit = readdirSync(dir).find((name) => /^Pretendard.*\.(?:otf|ttf|woff2)$/iu.test(name));
      if (hit) return { file: join(dir, hit), source: "system" };
    } catch {
      // directory absent on this platform
    }
  }
  return null;
}
