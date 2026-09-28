import dns from "node:dns/promises";
import net from "node:net";
import type { PublicSourceResolvedAddress } from "./lit-fetch.ts";
import { publicSourceErrorReason } from "./lit-fetch-url.ts";

export type PublicUrlGuard =
  | { readonly safe: true; readonly addresses?: readonly PublicSourceResolvedAddress[] }
  | { readonly safe: false; readonly reason: string };

export async function assertSafePublicUrl(
  url: URL,
  allowPrivateNetwork: boolean,
  resolveHostname?: (hostname: string) => Promise<readonly PublicSourceResolvedAddress[]>
): Promise<PublicUrlGuard> {
  const hostname = normalizeHostname(url.hostname);
  if (hostname.includes("@")) return { safe: false, reason: "hostname contains userinfo separator" };
  if (looksLikeNonCanonicalIpv4(hostname)) return { safe: false, reason: "non-canonical numeric IPv4 host is not allowed" };

  const directIpVersion = net.isIP(hostname);
  if (directIpVersion !== 0) {
    if (!allowPrivateNetwork && isPrivateAddress(hostname)) return { safe: false, reason: "private network target" };
    return { safe: true, addresses: [{ address: hostname, family: directIpVersion === 6 ? 6 : 4 }] };
  }
  if (hostname.toLowerCase() === "localhost" || hostname.toLowerCase() === "localhost.") {
    if (allowPrivateNetwork) return { safe: true, addresses: [{ address: "127.0.0.1", family: 4 }] };
    return { safe: false, reason: "localhost target" };
  }

  try {
    const records = resolveHostname
      ? await resolveHostname(hostname)
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return { safe: false, reason: "hostname did not resolve" };
    for (const record of records) {
      if (!allowPrivateNetwork && isPrivateAddress(record.address)) return { safe: false, reason: "hostname resolves to private network" };
    }
    return {
      safe: true,
      addresses: records.map((record) => ({ address: record.address, family: record.family === 6 ? 6 : 4 }))
    };
  } catch (error) {
    return { safe: false, reason: `DNS lookup failed: ${publicSourceErrorReason(error)}` };
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function looksLikeNonCanonicalIpv4(hostname: string): boolean {
  if (/^\d+$/.test(hostname)) return true;
  return hostname.split(".").some((part) => /^0x[0-9a-f]+$/i.test(part) || /^0\d+$/.test(part));
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice("::ffff:".length));
  const version = net.isIP(normalized);
  if (version === 4) {
    const [a = 0, b = 0] = normalized.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }
  return true;
}
