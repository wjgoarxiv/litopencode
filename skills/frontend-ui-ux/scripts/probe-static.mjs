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
    ["SLOP-058", /href\s*=\s*["'](?:#|javascript:)[^"']*["']/giu, "MEDIUM", "real destination"],
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
  for (const file of sourceFiles(root)) {
    const body = readFileSync(file, "utf8");
    for (const [rule, pattern, severity, threshold] of signatures) {
      for (const match of body.matchAll(pattern)) {
        if (findings.filter((row) => row.rule === rule).length >= 30) break;
        findings.push({ rule, severity, tier: "derived", viewport, selector: `${relative(base, file)}:${body.slice(0, match.index).split("\n").length}`, value: match[0], threshold, note: "source signature; render not observed" });
      }
    }
  }
  return { findings, notVerified: renderedRules.map((rule) => ({ rule, viewport, reason: "static fallback: needs a rendered DOM" })) };
}
