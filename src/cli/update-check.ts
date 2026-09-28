import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshUpdateCache } from "./update-notifier.ts";

export async function runUpdateCheckHelper(
  argv: readonly string[],
  refresh: () => Promise<void> = refreshUpdateCache
): Promise<void> {
  if (argv.length !== 1 || argv[0] !== "--refresh") return;
  await refresh();
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await runUpdateCheckHelper(argv);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch(() => undefined);
}
