const redactionMarker = "[redacted]";

export function collectPublicUrlValueVariants(target: Set<string>, url: URL): void {
  for (const [, value] of url.searchParams) addValueVariants(target, value);
  for (const pair of url.search.slice(1).split("&")) {
    const separator = pair.indexOf("=");
    if (separator >= 0) addValueVariants(target, pair.slice(separator + 1));
  }
  if (url.hash.length > 1) addValueVariants(target, url.hash.slice(1));
}

export function redactPublicSourceContent(content: string, variants: ReadonlySet<string>): string {
  let redacted = content;
  const longestFirst = [...variants].filter((value) => value.length > 0).sort((left, right) => right.length - left.length);
  for (const value of longestFirst) redacted = redacted.replaceAll(value, redactionMarker);
  return redacted;
}

function addValueVariants(target: Set<string>, value: string): void {
  if (value.length === 0) return;
  const decoded = decodeQueryValue(value);
  const encoded = encodeURIComponent(decoded);
  for (const variant of [
    value,
    decoded,
    encoded,
    encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
    new URLSearchParams([["value", decoded]]).toString().slice("value=".length)
  ]) {
    if (variant.length > 0) target.add(variant);
  }
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
}
