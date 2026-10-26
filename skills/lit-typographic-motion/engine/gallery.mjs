// `render.mjs styles --out <dir> [--format 16:9|9:16]`: the style gallery. One short demo film, the
// same treatment and the same drawings, rendered as a board round in every house style, so a person
// can see what each style looks like before asking for a film. Each style's board lands in
// `<dir>/<style>/stills/board.png`, and `<dir>/styles.png` puts them side by side. The demo also
// proves the styles and the scaffold pass the board check as shipped.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT } from "./constants.mjs";
import { areaResize, decodePng, encodePng } from "./png.mjs";
import { scaffoldHtml } from "./scaffold.mjs";
import { tile } from "./stills.mjs";
import { STYLE_IDS, readStyle } from "./styles.mjs";

const COPY = ["작게 시작해서 끝까지", "One clock for every frame", "한 화면에 한 가지 생각", "Same house, every film"];

// The demo treatment for one style: four shots, one of each text layout, 12 s.
export function demoTreatment(styleId, format = "16:9") {
  const style = readStyle(styleId);
  const hand = (i) => style.transitions[i % style.transitions.length];
  const vertical = format === "9:16" ? " vertical" : "";
  const beats = [
    { t0: 0, t1: 3, layout: "title", hero: "The opening line lands while a ring draws itself behind it.", purpose: "Open on the promise.", onScreen: "A ring drawing on behind the opening line.", motion: "The ring draws on; the line rises in.", sound: "Pad opens with a hit on the first word." },
    { t0: 3, t1: 6, layout: "split", hero: "Five bars rise in turn beside the line.", purpose: "Show the system.", onScreen: "Five bars rising beside one line.", motion: "Bars rise in stagger.", sound: "Hit on the cut." },
    { t0: 6, t1: 9, layout: "split-alt", hero: "A dot travels a path from left to right.", purpose: "Show one idea per screen.", onScreen: "A dot crossing a drawn path.", motion: "The dot travels the path.", sound: "A rise into the close." },
    { t0: 9, t1: 12, layout: "stage", hero: "A grid of squares settles above the closing line.", purpose: "Close on the house.", onScreen: "A settling grid of squares over a closing caption.", motion: "Squares settle in stagger.", sound: "Closing cadence." }
  ].map((b, i, all) => ({ ...b, lines: [i], transition: i === all.length - 1 ? "end" : hand(i) }));
  const colours = [["ground", "ground"], ["ink", "copy"], ["signal", "signal"], ["muted", "grid"]];
  return {
    // A calibration sheet, not a film: the same simple demo in every style, so the styles compare.
    request: `render a 12 s${vertical} minimal demo film in the ${styleId} style`,
    register: "minimal",
    genre: "other", path: "stage", pathReason: "The demo draws shapes beside its type, which the type engine cannot draw.",
    style: styleId,
    idea: "Four screens, one per layout, so the house style can be judged before a film is made.",
    audience: "Someone choosing a house style for their films.", channel: "A gallery sheet viewed before a film is made, played with sound.",
    format, formatReason: format === "9:16" ? "The gallery shows the vertical layouts." : "The gallery shows the landscape layouts.",
    durationSec: 12, beats,
    story: { expect: "A style sheet is four unrelated pictures.", turn: "The dot crosses its path and shows the four screens are one system.", beat: 2, payoff: "The grid settles and the house reads as one piece." },
    protagonist: { name: "the dot", kind: "object", look: "a small round dot in the signal colour, a twentieth of the frame high", acts: [{ beat: 0, action: "waits inside the ring" }, { beat: 1, action: "stands beside the bars" }, { beat: 2, action: "travels its path" }, { beat: 3, action: "settles into the grid" }] },
    subject: { name: "the style demo", source: "invented", specifics: ["Four screens with a ring, bars, a travelling dot and a grid.", "Each screen uses one layout of the house grid."] },
    visualDevices: [{ kind: "shape", role: "subject", beats: [0, 1, 2, 3] }, { kind: "path", role: "support", beats: [2] }],
    typePlan: { faces: [style.faces.headline.family], hierarchy: "One line per screen in the style's headline or display size.", maxWordsOnScreen: 6 },
    palette: colours.map(([key, role]) => ({ hex: style.palette[key], role })),
    sound: { mode: "generated", plan: "The style's own bed with a hit on the cuts and a closing cadence.", palette: style.beds[0].palette, key: style.beds[0].key, tempo: style.beds[0].tempo },
    copy: { source: "invented", lines: COPY },
    inventions: ["the style demo (its four screens)", "all four copy lines"],
    ambition: "Each screen shows one layout cleanly so the style's type, colour and motion read at a glance."
  };
}

// The demo's drawings: generic shapes in the style's own colours, one per shot.
const DEMO_DRAW = [
  `(s, svg) => {
      const z = LitStage.zone(s.layout, "subject");
      const r = Math.min(z.w, z.h) * 0.34;
      const len = 2 * Math.PI * r;
      svg.innerHTML = \`<circle cx="\${z.w * 0.5}" cy="\${z.h * 0.5}" r="\${r}" fill="none" stroke="var(--lit-line)" stroke-width="6"/><circle cx="\${z.w * 0.5}" cy="\${z.h * 0.5}" r="\${r}" fill="none" stroke="var(--lit-signal)" stroke-width="6" stroke-dasharray="\${len}" stroke-dashoffset="\${len * (1 - s.enter(0, 1.6))}"/>\`;
    },`,
  `(s, svg) => {
      const z = LitStage.zone(s.layout, "subject");
      const w = z.w / 9;
      svg.innerHTML = [0, 1, 2, 3, 4].map((k) => { const h = z.h * (0.3 + 0.12 * k) * s.enter(0.1 + k * T.stagger.item * 2, T.dur.hero); return \`<rect x="\${w * (1 + k * 1.6)}" y="\${z.h * 0.9 - h}" width="\${w}" height="\${h}" fill="\${k === 4 ? "var(--lit-accent, var(--lit-signal))" : "var(--lit-signal)"}"/>\`; }).join("");
    },`,
  `(s, svg) => {
      const z = LitStage.zone(s.layout, "subject");
      const x = z.w * (0.1 + 0.8 * T.ease.move(LitStage.clamp(s.local / (s.length * 0.8))));
      svg.innerHTML = \`<path d="M\${z.w * 0.1} \${z.h * 0.6} C \${z.w * 0.35} \${z.h * 0.2}, \${z.w * 0.65} \${z.h * 0.9}, \${z.w * 0.9} \${z.h * 0.45}" fill="none" stroke="var(--lit-line)" stroke-width="5"/><circle cx="\${x}" cy="\${z.h * 0.55}" r="\${z.h * 0.06}" fill="var(--lit-signal)"/>\`;
    },`,
  `(s, svg) => {
      const z = LitStage.zone(s.layout, "subject");
      const n = 8;
      const c = Math.min(z.w / (n + 2), z.h / 4);
      const cells = [];
      for (let k = 0; k < n * 2; k++) { const e = s.enter(0.05 * k, T.dur.move); cells.push(\`<rect x="\${c * (1 + (k % n)) + c * 0.1}" y="\${z.h * 0.3 + c * Math.floor(k / n) + (1 - e) * 30}" width="\${c * 0.8}" height="\${c * 0.8}" opacity="\${e}" fill="\${k === 11 ? "var(--lit-accent, var(--lit-signal))" : "var(--lit-muted)"}"/>\`); }
      svg.innerHTML = cells.join("");
    },`
];

// The demo page: the scaffold with the demo drawings in its DRAW slots.
export function demoPage(treatment) {
  let k = 0;
  return scaffoldHtml(treatment).replace(/ {4}\(s, svg, t\) => \{\},/gu, () => `    ${DEMO_DRAW[k++ % DEMO_DRAW.length]}`);
}

const toRgba = (image) => {
  if (image.channels === 4) return image.pixels;
  const out = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += image.channels, j += 4) { out[j] = image.pixels[i]; out[j + 1] = image.pixels[i + 1]; out[j + 2] = image.pixels[i + 2]; out[j + 3] = 255; }
  return out;
};

// Renders the gallery: a board round per style, then one sheet of the four boards. `render` is
// renderStage; it is passed in so the gallery stays testable without a browser.
export async function stylesCommand(out, { format = "16:9", render, log = () => {} }) {
  if (!["16:9", "9:16"].includes(format)) throw Object.assign(new Error("--format is 16:9 or 9:16"), { exitCode: 2 });
  mkdirSync(out, { recursive: true });
  const boards = [];
  const verdicts = [];
  for (const id of STYLE_IDS) {
    const dir = path.join(out, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.join(dir, "stage"), { recursive: true });
    const treatment = demoTreatment(id, format);
    writeFileSync(path.join(dir, "treatment.json"), `${JSON.stringify(treatment, null, 2)}\n`);
    writeFileSync(path.join(dir, "stage", "index.html"), demoPage(treatment));
    log(`styles: rendering the ${id} board`);
    const result = await render(dir, { round: 1, stillsOnly: true });
    const failed = result.board.failed.map((rule) => rule.id);
    verdicts.push({ id, pass: failed.length === 0, text: `${id}: ${failed.length ? `board check FAIL (${failed.join(", ")})` : "board check PASS"}` });
    boards.push(decodePng(readFileSync(path.join(dir, "stills", "board.png"))));
  }
  const images = boards.map((board) => areaResize(toRgba(board), board.width, board.height, 960, 540, 4));
  const sheet = tile(images, 2, 960, 540, 8);
  const file = path.join(out, "styles.png");
  writeFileSync(file, encodePng(sheet.width, sheet.height, sheet.pixels, 4, 6));
  const failing = verdicts.filter((verdict) => !verdict.pass);
  return { code: failing.length ? EXIT.GATE_FAIL_QA : EXIT.OK, file, message: `STYLES: ${file}\n${verdicts.map((verdict) => verdict.text).join("\n")}` };
}
