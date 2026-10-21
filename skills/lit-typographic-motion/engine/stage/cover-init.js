// Cover init: injected into a cover page before any of its own scripts (engine/cover/capture.mjs).
// A cover frame is a pure function of loop time t, and the renderer asks for frames out of order,
// so every wall clock, frame loop and unseeded entropy source answers with an error instead of a
// value. Each refusal is remembered by name, because a page may swallow the error in a try block;
// the renderer reads the list after every frame and stops with exit 18 naming the call. CSS
// animations and transitions would run on the real clock, so they are switched off.
(function () {
  "use strict";
  const used = [];
  const refuse = (name, instead) => function refused() {
    if (!used.includes(name)) used.push(name);
    throw new Error(`${name} is not available in a cover page: ${instead}`);
  };
  const fromT = "draw every frame from t";
  const RealDate = Date;
  function CoverDate(...args) {
    if (new.target && args.length > 0) return new RealDate(...args);
    return refuse("Date", fromT)();
  }
  CoverDate.prototype = RealDate.prototype;
  CoverDate.now = refuse("Date.now", fromT);
  CoverDate.parse = RealDate.parse;
  CoverDate.UTC = RealDate.UTC;
  Object.defineProperty(window, "Date", { value: CoverDate, writable: true, configurable: true });
  Object.defineProperty(Performance.prototype, "now", { value: refuse("performance.now", fromT), writable: true, configurable: true });
  Math.random = refuse("Math.random", "use LitLoop.rng(seed) for layout and t for motion");
  window.requestAnimationFrame = refuse("requestAnimationFrame", "the renderer calls renderFrame(t); a cover page runs no loop of its own");
  window.setInterval = refuse("setInterval", "the renderer calls renderFrame(t); a cover page runs no loop of its own");
  if (window.crypto) Object.defineProperty(window.crypto, "getRandomValues", { value: refuse("crypto.getRandomValues", "use LitLoop.rng(seed)"), configurable: true });
  const still = () => {
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.documentElement) still();
  else document.addEventListener("readystatechange", still, { once: true });
  window.__litCover = Object.freeze({ used: () => used.slice() });
})();
