#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const tscBin = "node_modules/typescript/bin/tsc";
const sourceEntry = "src/index.ts";

if (!fs.existsSync(tscBin)) {
  console.log("typecheck skipped: TypeScript dev dependency is not installed in this packed artifact.");
  process.exit(0);
}

if (!fs.existsSync(sourceEntry)) {
  console.log("typecheck skipped: TypeScript source files are not present in this packed artifact.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [tscBin, "--noEmit"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "inherit"
});

process.exit(result.status ?? 1);
