// The package's `./tui` export, shared by both hosts like `./server`: OpenCode 1 calls `tui()` and
// OpenCode 2 calls `setup()`. OpenCode 2 loads it on its own for an active server plugin, so no
// separate TUI registration is needed there.
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import type { Plugin } from "@opencode/plugin/tui";

// As for `./server`: the shipped declaration describes the entry by its shape, not by the host packages.
type TuiEntry = {
  readonly id: string;
  tui(api: unknown, options: unknown, meta: unknown): Promise<void>;
  setup(context: unknown): Promise<() => Promise<void> | void>;
};

const tuiEntry: TuiEntry = {
  id: "litopencode",
  async tui(...args: Parameters<TuiPlugin>): Promise<void> {
    const { default: plugin } = await import("../tui.ts");
    await plugin.tui(...args);
  },
  async setup(context: Plugin.Context): Promise<Plugin.Cleanup> {
    const { setupLitOpenCodeTui } = await import("../v2/tui.ts");
    return setupLitOpenCodeTui(context);
  }
} satisfies Plugin.Definition & { readonly tui: TuiPlugin };

export default tuiEntry;
