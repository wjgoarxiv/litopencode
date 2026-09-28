// Reports what language-server coverage the OpenCode host actually declares.
//
// LitOpenCode bundles no language server and starts no daemon. The `lsp` and `lsp-setup` skills both
// depend on one question being answerable before anything else: does a server exist for the file
// type in front of me? Without this check the answer is a guess, and the failure mode the two skills
// exist to prevent -- reporting "no errors" from an environment where nothing inspected the file --
// is exactly what a guess produces.
//
// This reads the host's declaration. It never starts a server, never installs one, and never writes
// configuration.

export type LspServerReport = {
  readonly id: string;
  readonly command: string;
  readonly extensions: readonly string[];
  readonly disabled: boolean;
};

export type LspCapabilityReport = {
  readonly declared: boolean;
  readonly servers: readonly LspServerReport[];
  readonly servedExtensions: readonly string[];
  readonly disabledServers: readonly string[];
  readonly malformed: readonly string[];
  // An honest tri-state. "unknown" is not "none": a host that declares nothing may still serve a
  // language natively, and claiming otherwise would be the same false confidence in reverse.
  readonly verdict: "declared" | "none-declared" | "unknown";
  readonly note: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCommand(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value.join(" ");
  return "";
}

// Two spellings exist across the family's config dialects: an `extensions` array and an
// `extensionToLanguage` map. Both are read, because a host that uses either is still serving.
function readExtensions(entry: Record<string, unknown>): readonly string[] {
  const collected: string[] = [];
  const extensions = entry["extensions"];
  if (Array.isArray(extensions)) {
    for (const extension of extensions) if (typeof extension === "string") collected.push(extension);
  }
  const map = entry["extensionToLanguage"];
  if (isRecord(map)) collected.push(...Object.keys(map));
  return [...new Set(collected.map((extension) => (extension.startsWith(".") ? extension : `.${extension}`)))].sort();
}

export function inspectLspCapability(hostConfig: Record<string, unknown> | null): LspCapabilityReport {
  if (hostConfig === null) {
    return {
      declared: false,
      servers: [],
      servedExtensions: [],
      disabledServers: [],
      malformed: [],
      verdict: "unknown",
      note: "No readable OpenCode config, so language-server coverage could not be determined. Treat an empty diagnostic result as no evidence rather than a clean result."
    };
  }

  const lsp = hostConfig["lsp"];
  if (!isRecord(lsp)) {
    return {
      declared: false,
      servers: [],
      servedExtensions: [],
      disabledServers: [],
      malformed: [],
      verdict: "none-declared",
      note: "The OpenCode config declares no lsp block. The host may still serve some languages natively; confirm before reporting diagnostics as clean, and use the lsp-setup skill for an unserved file type."
    };
  }

  const servers: LspServerReport[] = [];
  const malformed: string[] = [];
  for (const [id, rawEntry] of Object.entries(lsp)) {
    if (!isRecord(rawEntry)) {
      malformed.push(id);
      continue;
    }
    servers.push({
      id,
      command: readCommand(rawEntry["command"]),
      extensions: readExtensions(rawEntry),
      disabled: rawEntry["disabled"] === true
    });
  }

  const enabled = servers.filter((server) => !server.disabled);
  const servedExtensions = [...new Set(enabled.flatMap((server) => server.extensions))].sort();

  return {
    declared: servers.length > 0,
    servers,
    servedExtensions,
    disabledServers: servers.filter((server) => server.disabled).map((server) => server.id),
    malformed,
    verdict: enabled.length > 0 ? "declared" : "none-declared",
    note:
      enabled.length > 0
        ? "Diagnostics for a served extension are real evidence. For any extension not listed here, an empty diagnostic result means nothing was checked; use the lsp-setup skill."
        : "Every declared server is disabled or malformed, so no extension is currently served. Treat empty diagnostics as absence of capability."
  };
}

// The question the lsp and lsp-setup skills actually ask, answerable per file.
export function servesExtension(report: LspCapabilityReport, extension: string): boolean {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return report.servedExtensions.some((candidate) => candidate.toLowerCase() === normalized);
}
