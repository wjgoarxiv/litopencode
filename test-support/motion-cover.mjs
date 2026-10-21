// Cover-mode fixtures for the motion tests: a valid cover treatment to clone and break, a finished
// cover run written without Chrome (treatment, stills, manifest, report), and a cover answers file.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function coverTreatment(overrides = {}) {
  return structuredClone({
    mode: "cover",
    request: "Make a looping README cover for the loop kit test.",
    idea: "Thin bars drift under a sweeping lit span while four markers flash beneath a fixed word.",
    recipe: "own",
    recipeReason: "A test system that keeps one rule, three layers and a still word.",
    brandWord: "LOOPKIT",
    aspect: "2:1",
    loopSec: 6,
    fps: 16,
    layers: { slow: "Bars drift one period per loop.", mid: "A lit span sweeps across the bars once per loop.", beat: "Four markers flash and a cursor steps between them." },
    system: { rule: "One bar shape.", copies: "Twenty-two bars in two strips.", offset: "Each bar's offset comes from its index." },
    title: { box: [0.275, 0.383, 0.45, 0.233], kind: "live" },
    ambition: "Every layer moves with hard edges so the encoder keeps it.",
    ...overrides
  });
}

/** A cover run as a finished render leaves it, with tiny stills; `verdict` is the report's first line. */
export function fakeCoverRun(out, { verdict = "PASS+TARGET", round = 1, treatment = coverTreatment() } = {}) {
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  fs.mkdirSync(path.join(out, ".run"), { recursive: true });
  fs.writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment, null, 2) + "\n");
  const files = [];
  for (const [name, kind] of [["frame-00.png", "frame"], ["poster.png", "poster"], ["seam.png", "seam"], ["sheet.png", "sheet"]]) {
    const bytes = encodePng(8, 4, Buffer.alloc(8 * 4 * 4, 40 + 30 * files.length), 4, 6);
    fs.writeFileSync(path.join(out, "stills", name), bytes);
    files.push({ file: `stills/${name}`, kind, sha256: sha256(bytes) });
  }
  const index = { schemaVersion: 1, path: "cover", mode: "cover", round, size: [1000, 500], fps: 16, durationSec: 6.048, files, gate: { pass: true, target: verdict === "PASS+TARGET" } };
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify(index, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "gate-report.txt"), `COVER gate --strict: ${verdict}\n`);
  const manifest = { schemaVersion: 1, mode: "cover", path: "cover", craftRound: round, treatmentSha256: sha256(fs.readFileSync(path.join(out, "treatment.json"))), stillsSha256: sha256(fs.readFileSync(path.join(out, "stills", "stills.json"))) };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return out;
}

export function coverAnswers(overrides = {}) {
  return {
    viewed: ["stills/sheet.png", "stills/poster.png", "stills/seam.png"],
    change: "Narrow the light edge from 60 to 24 painting pixels so the encoder keeps it.",
    answers: [1, 2, 3, 4, 5, 6, 7, 8].map((q) => ({
      q, verdict: q <= 5 ? "yes" : "no", frame: q === 2 ? "stills/seam.png" : "stills/sheet.png",
      observed: `Question ${q}: the orange span sits over a different group of bars in every tile of the sheet.`
    })),
    ...overrides
  };
}
