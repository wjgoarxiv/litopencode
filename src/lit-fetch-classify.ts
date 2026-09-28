import type { PublicSourceVerdict } from "./lit-fetch.ts";

export type ClassifiedPublicResponse = {
  readonly ok: boolean;
  readonly verdict: PublicSourceVerdict;
  readonly reason?: string;
  readonly positiveProof: boolean;
};

export function classifyPublicResponse(
  status: number,
  text: string,
  contentType: string | undefined
): ClassifiedPublicResponse {
  if (status === 404) return { ok: false, verdict: "not_found", reason: "HTTP 404", positiveProof: false };
  if (status === 401) return { ok: false, verdict: "authentication_required", reason: "HTTP 401", positiveProof: false };
  if (status === 402) return { ok: false, verdict: "paywall", reason: "HTTP 402", positiveProof: false };
  if (status === 429) return { ok: false, verdict: "rate_limited", reason: "HTTP 429", positiveProof: false };
  if (status >= 500) return { ok: false, verdict: "upstream_error", reason: `HTTP ${status}`, positiveProof: false };
  if (status >= 400) return { ok: false, verdict: "blocked", reason: `HTTP ${status}`, positiveProof: false };

  if (text.trim().length === 0) return { ok: false, verdict: "route_coverage_incomplete", reason: "empty response body", positiveProof: false };
  if (contentType === "application/json" || /^[ \t]*application\/[^;]+\+json$/i.test(contentType ?? "")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (parsed === null || (Array.isArray(parsed) && parsed.length === 0) || (typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0)) {
        return { ok: false, verdict: "route_coverage_incomplete", reason: "JSON response contained no fields", positiveProof: false };
      }
    } catch {
      return { ok: false, verdict: "route_coverage_incomplete", reason: "invalid JSON response", positiveProof: false };
    }
    if (contentType === "application/problem+json" || isErrorShapedJson(parsed)) {
      return { ok: false, verdict: "route_coverage_incomplete", reason: "JSON response is an error document", positiveProof: false };
    }
    return { ok: true, verdict: "success", positiveProof: true };
  }
  const isHtmlLike = contentType === "text/html" || /^<!doctype\s+html/i.test(text.trim()) || /^<html[\s>]/i.test(text.trim());
  if (isHtmlLike) {
    const visible = visibleText(text);
    const hasSubstantiveContainer = hasSubstantiveContentContainer(text, visible);
    if (
      /\b(?:404\s+not\s+found|page\s+not\s+found|internal\s+server\s+error)\b/i.test(visible) &&
      !hasSubstantiveContainer
    ) {
      return { ok: false, verdict: "route_coverage_incomplete", reason: "HTML error template without requested content", positiveProof: false };
    }
    const lower = text.toLowerCase();
    const dominantInterstitial = !hasSubstantiveContainer && visible.length <= 1_200;
    if (
      /sign in|required to continue|log in|login required|authentication required/.test(lower) &&
      (dominantInterstitial || hasLoginStructure(text))
    ) {
      return { ok: false, verdict: "authentication_required", reason: "authentication marker detected", positiveProof: false };
    }
    if (
      /subscribe to continue|paywall|subscription required|members only/.test(lower) &&
      (dominantInterstitial || hasPaywallStructure(text))
    ) {
      return { ok: false, verdict: "paywall", reason: "paywall marker detected", positiveProof: false };
    }
    if (
      /captcha|checking your browser|cloudflare|bot detection|access denied|javascript is disabled|enable javascript|enable cookies|are you human|verify you are human|just a moment/.test(lower) &&
      (dominantInterstitial || hasChallengeStructure(text))
    ) {
      return { ok: false, verdict: "blocked", reason: "challenge marker detected", positiveProof: false };
    }
  }
  const textLike = contentType === undefined || contentType.startsWith("text/") || /^(?:application|image)\/(?:xml|javascript|xhtml\+xml)$/i.test(contentType);
  if (!textLike || !hasPositiveContentProof(text, contentType)) {
    return { ok: false, verdict: "route_coverage_incomplete", reason: `HTTP ${status} without positive proof`, positiveProof: false };
  }
  return { ok: true, verdict: "success", positiveProof: true };
}

function isErrorShapedJson(value: unknown): boolean {
  if (!isJsonRecord(value)) return false;
  const status = value["status"];
  if (typeof status === "number" && status >= 400) return true;
  if (typeof status === "string" && /^\d{3}$/.test(status) && Number(status) >= 400) return true;
  if (Object.hasOwn(value, "error") && value["error"] !== null) return true;
  return Object.hasOwn(value, "errors") && value["errors"] !== null;
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSubstantiveContentContainer(html: string, visible: string): boolean {
  return /<(?:article|main)\b/i.test(html) && visible.length >= 160;
}

function hasLoginStructure(html: string): boolean {
  return /<form\b[\s\S]*?(?:type=["']?password|name=["']?(?:password|email|username)|sign in|log in)/i.test(html);
}

function hasPaywallStructure(html: string): boolean {
  return /<(?:dialog|section|aside|div)\b[^>]*(?:class|id)=["'][^"']*(?:paywall|subscribe|subscription|metered)/i.test(html);
}

function hasChallengeStructure(html: string): boolean {
  return /(?:class|id)=["'][^"']*(?:captcha|challenge|cf-|cloudflare)|<(?:form|iframe)\b[^>]*(?:captcha|challenge)/i.test(html);
}

function hasPositiveContentProof(text: string, contentType: string | undefined): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const isHtml = contentType === "text/html" || /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (isHtml) {
    if (/<(?:article|main|title|h1|h2|pre|code|table)\b/i.test(trimmed)) return true;
    return visibleText(trimmed).length >= 80;
  }
  return trimmed.length >= 16;
}

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
