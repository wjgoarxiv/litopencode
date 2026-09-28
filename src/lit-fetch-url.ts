export function parsePublicHttpUrl(input: string): URL {
  const url = new URL(input);
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") throw new Error("only http and https URLs are supported");
  if (!url.hostname) throw new Error("URL hostname is required");
  return url;
}

export function redactPublicUrl(input: string | URL): string {
  try {
    const url = typeof input === "string" ? new URL(input) : new URL(input.toString());
    url.username = url.username ? "[redacted]" : "";
    url.password = url.password ? "[redacted]" : "";
    url.hash = "";
    const redactedQuery = new URLSearchParams();
    for (const [key] of url.searchParams) redactedQuery.append(key, "[redacted]");
    url.search = redactedQuery.toString();
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function publicSourceErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
