import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cacheRoot = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "litopencode", "office");

function cached(label: string, lock: string, marker: string): boolean {
  const digest = createHash("sha256").update(readFileSync(path.join(packageRoot, lock))).digest("hex").slice(0, 16);
  return existsSync(path.join(cacheRoot, `${label}-${digest}`, marker));
}

export function inspectOfficeDependencies() {
  const onPath = (name: string) => (process.env.PATH ?? "").split(path.delimiter).some((dir) => existsSync(path.join(dir, name)));
  return {
    pptx: {
      nodeReady: cached("node", "skills/lit-pptx/package-lock.json", "node_modules/pptxgenjs"),
      pythonReady: cached("python-pptx", "skills/lit-pptx/requirements.lock", "bin/python")
    },
    docx: {
      pythonReady: cached("python-docx", "skills/lit-docx/requirements.lock", "bin/python")
    },
    optional: { pandoc: onPath("pandoc"), xelatex: onPath("xelatex"), soffice: onPath("soffice") }
  };
}
