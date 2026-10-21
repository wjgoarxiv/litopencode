// The package's `./server` export. OpenCode 1 and OpenCode 2 both load this file, and each host
// accepts one default-export object: OpenCode 1 calls `server()` and OpenCode 2 calls `setup()`. Each
// implementation is imported only by the host that runs it, so neither host loads the other's code.
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode/plugin";

// Both host plugin packages are dev dependencies, so the shipped declaration describes the entry by its
// shape; the `satisfies` below still checks it against both hosts' types at build time.
type ServerEntry = {
  readonly id: string;
  server(input: unknown): Promise<unknown>;
  setup(context: unknown): Promise<() => Promise<void> | void>;
};

const serverEntry: ServerEntry = {
  id: "litopencode",
  async server(input: PluginInput): Promise<Hooks> {
    const { default: plugin } = await import("../server.ts");
    return plugin(input);
  },
  async setup(context: Plugin.Context): Promise<Plugin.Cleanup> {
    const { setupLitOpenCodeServer } = await import("../v2/server.ts");
    return setupLitOpenCodeServer(context);
  }
} satisfies Plugin.Plugin & { readonly server: (input: PluginInput) => Promise<Hooks> };

export default serverEntry;
