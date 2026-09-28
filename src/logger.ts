import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "./state.ts";

export type Logger = {
  info(message: string): Promise<void>;
  error(message: string): Promise<void>;
  dispose(): Promise<void>;
};

export function createLogger(paths: RuntimePaths, options: { enabled?: boolean } = {}): Logger {
  const enabled = options.enabled === true;

  async function write(level: "info" | "error", message: string): Promise<void> {
    if (!enabled) return;

    await fs.mkdir(path.dirname(paths.logFile), { recursive: true });
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message
    });
    await fs.appendFile(paths.logFile, `${line}\n`, "utf8");
  }

  return {
    info: (message) => write("info", message),
    error: (message) => write("error", message),
    dispose: async () => {}
  };
}
