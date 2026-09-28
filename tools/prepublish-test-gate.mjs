import { spawnSync } from "node:child_process";
import process from "node:process";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run"),
);
const npmExecPath = env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const args = npmExecPath ? [npmExecPath, "test"] : ["test"];
const result = spawnSync(command, args, {
  env,
  stdio: "inherit",
  ...(process.platform === "win32" && !npmExecPath ? { shell: true } : {}),
});

if (result.error) {
  process.stderr.write(`prepublish test gate could not start npm test: ${result.error.message}\n`);
  process.exitCode = 1;
} else if (result.signal) {
  process.stderr.write(`prepublish test gate interrupted by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}
