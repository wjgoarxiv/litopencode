import type { PluginInput } from "@opencode-ai/plugin";

export type SessionLineage = {
  readonly parentID?: string;
};

export type SessionLookup = (sessionID: string) => Promise<SessionLineage | undefined>;

type OpencodeClient = PluginInput["client"];

export function createSessionLookup(client: OpencodeClient | undefined): SessionLookup | undefined {
  if (client === undefined) return undefined;
  return async (sessionID) => {
    const result = await client.session.get({ path: { id: sessionID } });
    const session: unknown = (result as { data?: unknown } | undefined)?.data;
    if (typeof session !== "object" || session === null) return undefined;
    const parentID = (session as { parentID?: unknown }).parentID;
    return { parentID: typeof parentID === "string" && parentID.length > 0 ? parentID : undefined };
  };
}
