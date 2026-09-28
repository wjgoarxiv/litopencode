// QA replay helpers, injected only into the QA browser (never the master). They read the page's text
// runs and, at a QA sample, hide every glyph for one capture so the renderer can difference the two
// frames into an ink mask. Nothing here runs unless the QA driver calls it.
(() => {
  "use strict";
  const blockDisplays = /^(?:block|flex|grid|list-item|table|table-cell|table-caption|flow-root|inline-block|inline-flex|inline-grid)$/u;
  const skipTags = new Set(["SCRIPT", "STYLE", "TITLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);
  const normalize = (text) => String(text).normalize("NFC").toLowerCase().replace(/[\s\p{P}]/gu, "");

  function opacityChain(el) {
    let value = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement ?? (node.parentNode?.host ?? null)) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return 0;
      value *= Number(style.opacity);
    }
    return value;
  }
  function scaleOf(el) {
    if (el instanceof SVGElement && el.getScreenCTM) { const m = el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 1; }
    let scale = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const t = getComputedStyle(node).transform;
      if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); scale *= Math.hypot(m.a, m.b); }
    }
    return scale;
  }
  function clipRects(el, rects) {
    let out = rects.map((r) => [r.left, r.top, r.right, r.bottom]);
    // The root and body clip to the viewport (handled below); a collapsed box clips nothing it contains.
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible" && style.clipPath === "none") continue;
      const box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      out = out.map(([x0, y0, x1, y1]) => [Math.max(x0, box.left), Math.max(y0, box.top), Math.min(x1, box.right), Math.min(y1, box.bottom)]).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
    }
    return out.map(([x0, y0, x1, y1]) => [Math.max(0, x0), Math.max(0, y0), Math.min(innerWidth, x1), Math.min(innerHeight, y1)]).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  }
  function runRoot(textNode) {
    const parent = textNode.parentElement;
    const marked = parent.closest("[data-lit-text]");
    if (marked) return marked;
    if (parent.closest("svg")) return parent.closest("text") ?? parent;
    for (let node = parent; node; node = node.parentElement) if (node === document.body || blockDisplays.test(getComputedStyle(node).display)) return node;
    return parent;
  }

  // Every text run on screen now: DOM and SVG text, ::before/::after content and registered canvas text.
  function collectRuns() {
    const groups = new Map();
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim() || !node.parentElement || skipTags.has(node.parentElement.tagName) || node.parentElement.closest("title,desc,defs")) continue;
      const root = runRoot(node);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(node);
    }
    const runs = [];
    for (const [root, nodes] of groups) {
      const range = document.createRange();
      const rects = [], elements = new Set();
      let opacity = 1, fontSize = 0, weight = 400, scale = 1, gradient = false;
      for (const node of nodes) {
        range.selectNodeContents(node);
        rects.push(...clipRects(node.parentElement, [...range.getClientRects()]));
        const el = node.parentElement;
        elements.add(el);
        opacity = Math.min(opacity, opacityChain(el));
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize), s = scaleOf(el);
        if (size * s > fontSize * scale) { fontSize = size; scale = s; weight = Number(style.fontWeight) || 400; }
        if (/text/u.test(style.webkitBackgroundClip || style.backgroundClip) || /url\(|gradient/u.test(style.fill)) gradient = true;
      }
      const text = nodes.map((node) => node.nodeValue).join("").replace(/\s+/gu, " ").trim();
      runs.push({ text, norm: normalize(text), rects, opacity, fontSize, scale, weight, gradient, decor: root.closest("[data-lit-decor]") !== null, kind: root instanceof SVGElement ? "svg" : "dom", elements: [...elements] });
    }
    for (const el of document.querySelectorAll("body *")) {
      for (const pseudo of ["::before", "::after"]) {
        const content = getComputedStyle(el, pseudo).content;
        if (!content || content === "none" || content === "normal" || !/^["']/u.test(content)) continue;
        const text = content.slice(1, -1).trim();
        if (!text) continue;
        const style = getComputedStyle(el, pseudo);
        runs.push({ text, norm: normalize(text), rects: clipRects(el, [el.getBoundingClientRect()]), opacity: opacityChain(el), fontSize: parseFloat(style.fontSize), scale: scaleOf(el), weight: Number(style.fontWeight) || 400, gradient: false, decor: el.closest("[data-lit-decor]") !== null, kind: "pseudo", elements: [el] });
      }
    }
    for (const entry of window.__litStage.registered()) {
      runs.push({ text: entry.content, norm: normalize(entry.content), rects: [[entry.x, entry.y, entry.x + entry.w, entry.y + entry.h]], opacity: 1, fontSize: entry.h, scale: 1, weight: 400, gradient: false, decor: entry.decor, kind: "canvas", elements: [] });
    }
    return runs;
  }

  let hidden = null;
  function strip(runs) {
    return runs.map(({ elements, ...rest }) => rest);
  }
  // Marks the run elements, then hides their glyphs with one rule (transitions left alone; the driver
  // cancels any animation the rule starts).
  function hideText(runs) {
    const marked = [];
    for (const run of runs) for (const el of run.elements) {
      el.dataset.litQaInk = "";
      const style = getComputedStyle(el);
      if (/text/u.test(style.webkitBackgroundClip || style.backgroundClip)) el.dataset.litQaClip = "";
      for (const prop of ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color"]) el.style.setProperty(prop, style.getPropertyValue(prop));
      marked.push(el);
    }
    const sheet = document.createElement("style");
    sheet.textContent = "[data-lit-qa-ink] { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-decoration-color: transparent !important; }\n" +
      "[data-lit-qa-clip] { background-image: none !important; }\n" +
      "svg text[data-lit-qa-ink], svg [data-lit-qa-ink] tspan, svg tspan[data-lit-qa-ink], svg textPath[data-lit-qa-ink] { fill: transparent !important; stroke: transparent !important; }";
    document.head.appendChild(sheet);
    hidden = { sheet, marked };
  }
  function showText() {
    if (!hidden) return;
    hidden.sheet.remove();
    for (const el of hidden.marked) {
      delete el.dataset.litQaInk; delete el.dataset.litQaClip;
      for (const prop of ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color"]) el.style.removeProperty(prop);
    }
    hidden = null;
  }

  let known = new Set();
  let current = [];
  Object.defineProperty(window, "__litQa", {
    value: Object.freeze({
      runs() { current = collectRuns(); return strip(current); },
      snapshot() { known = new Set(document.getAnimations()); },
      hide() { hideText(current); },
      show() { showText(); },
      cancelNew() {
        getComputedStyle(document.documentElement).opacity;
        let cancelled = 0;
        for (const animation of document.getAnimations()) if (!known.has(animation)) { animation.cancel(); cancelled += 1; }
        return cancelled;
      },
      settle() { return new Promise((resolve) => window.__litStage.nativeRaf(() => window.__litStage.nativeRaf(resolve))); },
      markFonts() {
        let k = 0;
        for (const run of current) for (const el of run.elements) if (!el.dataset.litQaRun) el.dataset.litQaRun = String(k++);
        return current.map((run) => run.elements.map((el) => el.dataset.litQaRun));
      },
      unmarkFonts() { for (const el of document.querySelectorAll("[data-lit-qa-run]")) delete el.dataset.litQaRun; },
      probeFaces(families) {
        const box = document.createElement("div");
        box.style.cssText = "position:absolute;left:0;top:0;opacity:0;pointer-events:none";
        families.forEach((family, i) => { const el = document.createElement("span"); el.dataset.litQaProbe = String(i); el.style.fontFamily = `"${family}"`; el.textContent = "Aa가"; box.appendChild(el); });
        document.body.appendChild(box);
        return () => box.remove();
      },
      canvasTexts() { return window.__litStage.canvasTexts(); }
    }),
    configurable: false
  });
})();
