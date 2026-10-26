import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

const sourceExtensions = new Set([".html", ".htm", ".css", ".jsx", ".tsx", ".js", ".ts"]);
const renderedRules = ["RS-001", "RS-002", "RS-003", "RS-004", "RS-006", "RS-007", "RS-008", "RS-009", "RS-010", "CF-101", "CF-102", "CF-103", "CF-104", "CF-201", "CF-202", "CF-204", "CF-205", "CF-301", "CF-302", "CF-303", "CF-401", "CF-404", "CF-603", "CF-701", "CF-702", "CF-703"];

function* sourceFiles(root, depth = 0) {
  if (!root || !existsSync(root) || depth > 8) return;
  if (statSync(root).isFile()) { if (sourceExtensions.has(extname(root))) yield root; return; }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".") || ["node_modules", "dist", "build"].includes(entry.name)) continue;
    yield* sourceFiles(join(root, entry.name), depth + 1);
  }
}

export function staticScan(root, viewport = "static") {
  const findings = [];
  const base = root && existsSync(root) && statSync(root).isFile() ? dirname(root) : root;
  const signatures = [
    ["SLOP-058", /href\s*=\s*["'](?:#|javascript:[^"']*)["']/giu, "MEDIUM", "real destination"],
    ["SLOP-057", /<img\b[^>]*src\s*=\s*["'](?:|#|undefined)["']/giu, "HIGH", "decodable source"],
    ["SLOP-009", /(?:background-clip|webkit-background-clip)\s*:\s*text[^}]{0,300}gradient\(/giu, "MEDIUM", "solid text"],
    ["SLOP-060", /lorem ipsum|\[placeholder\]|\[todo\]/giu, "LOW", "finished copy"],
    ["SLOP-061", /<marquee\b/giu, "LOW", "static or pausable content"],
    ["SLOP-040", /—|(?<=\s)–(?=\s)/gu, "MEDIUM", "plain punctuation"],
    ["SLOP-036", /\b(?:unleash|revolutionize|transformative platform|seamless experience|next.gen)\b/giu, "MEDIUM", "specific claim"],
    ["CF-503", /scale\(\s*0(?:[\s,)]|$)/giu, "LOW", "entrance scale >= 0.95"],
    ["CF-505", /\b(?:bounce|elastic)\b|cubic-bezier\([^)]*(?:-0\.|1\.[2-9])/giu, "MEDIUM", "non-overshooting easing"],
    ["CF-507", /will-change\s*:\s*(?:all|width|height|left|top|margin|padding)/giu, "LOW", "transform, opacity or filter"],
    ["CF-508", /transition(?:-property)?\s*:[^;]*(?:width|height|padding|margin|top|left)/giu, "MEDIUM", "transform or opacity"],
  ];
  const gradientText = [];
  for (const file of sourceFiles(root)) {
    const body = readFileSync(file, "utf8");
    // A kit starter slot left in a page. Framework templates use {{ }} on purpose, so only HTML is read.
    if ([".html", ".htm"].includes(extname(file))) {
      for (const match of body.matchAll(/\{\{(?! )[^{}\n]{1,80}(?<! )\}\}/gu)) {
        if (findings.filter((entry) => entry.rule === "DS-006").length >= 30) break;
        findings.push({ rule: "DS-006", severity: "HIGH", tier: "derived", viewport, selector: `${relative(base, file)}:${body.slice(0, match.index).split("\n").length}`, value: match[0], threshold: "no {{slot}} from the kit layouts", note: "source signature; render not observed" });
      }
    }
    for (const [rule, pattern, severity, threshold] of signatures) {
      for (const match of body.matchAll(pattern)) {
        const row = { rule, severity, tier: "derived", viewport, selector: `${relative(base, file)}:${body.slice(0, match.index).split("\n").length}`, value: match[0], threshold, note: "source signature; render not observed" };
        if (rule === "SLOP-009") { gradientText.push(row); continue; }
        if (findings.filter((entry) => entry.rule === rule).length >= 30) break;
        findings.push(row);
      }
    }
  }
  // Source alone cannot weigh contrast, so a static match is the violet form or a repeated one.
  const violet = (row) => (row.value.match(/#[\da-f]{6}\b/giu) ?? []).some((hex) => { const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)); const hi = Math.max(r, g, b), lo = Math.min(r, g, b); if (hi - lo < 50) return false; const d = hi - lo; const h = ((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360; return h >= 260 && h <= 310; });
  findings.push(...gradientText.filter((row) => gradientText.length > 1 || violet(row)).slice(0, 30));
  return { findings, notVerified: renderedRules.map((rule) => ({ rule, viewport, reason: "static fallback: needs a rendered DOM" })) };
}
