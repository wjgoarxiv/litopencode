// OpenCode's TUI loader hands these modules to TUI plugins from its own runtime, so the package does
// not depend on them. Only the members the mission plugin calls are declared.
declare module "solid-js" {
  export type Accessor<T> = () => T;
  export function createSignal<T>(value: T, options?: { readonly equals?: false | ((prev: T, next: T) => boolean) }): [Accessor<T>, (value: T) => T];
  export function createMemo<T>(fn: () => T): Accessor<T>;
  export function createEffect(fn: () => void): void;
  export function onCleanup(fn: () => void): void;
}

declare module "@opentui/solid" {
  export function useTerminalDimensions(): () => { readonly width: number; readonly height: number };
}

declare module "@opentui/solid/jsx-runtime" {
  export function jsx(type: string, props?: Record<string, unknown>): unknown;
}
