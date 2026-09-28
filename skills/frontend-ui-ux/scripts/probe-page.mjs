// Serialized into agent-browser eval. All helpers must stay inside this function.
export function inspectPage(viewport, t, state = {}) {
  const findings = [], notVerified = [], counts = new Map();
  const id = (el) => el?.id ? `#${CSS.escape(el.id)}` : el ? `${el.tagName.toLowerCase()}:nth-of-type(${[...el.parentElement?.children ?? []].filter((peer) => peer.tagName === el.tagName).indexOf(el) + 1})` : null;
  const path = (el) => { const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) parts.unshift(id(node)); return `body > ${parts.join(' > ')}`; };
  const add = (rule, severity, tier, el, value, threshold, note) => {
    if ((counts.get(rule) ?? 0) >= 30) return;
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
    findings.push({ rule, severity, tier, viewport, selector: id(el), value, threshold, ...(note ? { note } : {}) });
  };
  const unverified = (rule, reason) => notVerified.push({ rule, viewport, reason });
  const ownText = (el) => [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).map((node) => node.textContent).join(' ').trim();
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"],[hidden],[inert],details:not([open]) *')) return false;
    if (/(^|\s)(sr-only|visually-hidden)(\s|$)/iu.test(String(el.className?.baseVal ?? el.className ?? ''))) return false;
    const css = getComputedStyle(el), box = el.getBoundingClientRect();
    return css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) > 0 && box.width >= 2 && box.height >= 2 && box.right >= 0 && box.bottom >= 0 && box.left <= innerWidth && box.top <= innerHeight;
  };
  const color = (value) => {
    const hex = value?.match(/^#([\da-f]{3}|[\da-f]{6})$/iu);
    if (hex) { const raw = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]; return { c: [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16)), a: 1 }; }
    const n = value?.match(/[\d.]+/gu)?.map(Number); return n?.length >= 3 ? { c: n.slice(0, 3), a: n[3] ?? 1 } : null;
  };
  const luminance = (channels) => { const c = channels.map((n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const background = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node), paint = color(css.backgroundColor);
      if (css.backgroundImage !== 'none') return null;
      if (paint) layers.push({ paint, opacity: Number(css.opacity) });
      if (paint && paint.a * Number(css.opacity) >= .99) break;
    }
    let c = [255, 255, 255];
    for (const { paint, opacity } of layers.reverse()) { const alpha = paint.a * opacity; c = paint.c.map((v, i) => alpha * v + (1 - alpha) * c[i]); }
    return c;
  };
  const gradientStops = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node), paint = color(css.backgroundColor);
      if (/gradient\(/iu.test(css.backgroundImage)) return [...css.backgroundImage.matchAll(/rgba?\([^)]*\)|#[\da-f]{3,6}\b/giu)].map((match) => color(match[0])).filter(Boolean);
      if (css.backgroundImage !== 'none' || paint && paint.a * Number(css.opacity) >= .99) break;
    }
    return [];
  };
  const textRects = (el) => {
    const rects = [];
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
    }
    return rects.filter((r) => r.width && r.height);
  };
  const cjk = (text) => { const chars = [...text.replace(/\s/gu, '')]; return chars.length && chars.filter((v) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(v)).length / chars.length > .3; };
  const hsl = (channels) => {
    const [r, g, b] = channels.map((v) => v / 255), hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo, light = (hi + lo) / 2;
    let h = 0;
    if (d) { h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return { h, s: d ? d / (1 - Math.abs(2 * light - 1)) : 0 };
  };
  const overflow = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - innerWidth;
  if (overflow > t.pageOverflowTolerancePx) {
    add('RS-006', 'HIGH', 'measured', null, overflow, t.pageOverflowTolerancePx);
    if (state.zoomEmulation) add('RS-004', 'HIGH', 'derived', null, overflow, t.pageOverflowTolerancePx);
  }
  const elements = [...document.querySelectorAll('body *')].slice(0, 3000).filter(visible);
  const textElements = [], hues = [], accentSamples = [], targets = [], spacing = [], fontFamilies = new Set(), roles = new Set(), eyebrows = [], glows = [], stripes = [], tileGrids = [];
  const destructive = /\b(?:delete|remove|destroy|erase|discard|삭제|제거|폐기)\b/iu;
  const isTarget = (el) => el.matches('button,a[href],input,select,textarea,[role="button"]');
  const firstFilled = elements.find((el) => isTarget(el) && el.getBoundingClientRect().top < innerHeight && el.matches('button,a,[role="button"]') && color(getComputedStyle(el).backgroundColor)?.a > .5);
  const clearGap = (a, b) => {
    const x = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const y = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
    return x && y ? Math.hypot(x, y) : Math.max(x, y);
  };
  for (const el of elements) {
    const css = getComputedStyle(el), box = el.getBoundingClientRect(), text = ownText(el);
    if (text) {
      textElements.push(el);
      if (!el.children.length && text.length > 1 && !/icon/i.test(String(el.className))) fontFamilies.add(css.fontFamily.split(',')[0].replaceAll(/["']/gu, '').trim());
      if (viewport === '390' && !el.matches('input,select,textarea')) roles.add(`${css.fontFamily.split(',')[0].replaceAll(/["']/gu, '').trim()}|${Math.round(Number.parseFloat(css.fontSize))}|${Number.parseFloat(css.fontWeight) <= 400 ? 'regular' : Number.parseFloat(css.fontWeight) <= 600 ? 'medium' : 'bold'}`);
      if (Number.parseFloat(css.fontSize) < t.bodyWeightSizePx && Number.parseFloat(css.fontWeight) < t.bodyWeightMin || Number.parseFloat(css.fontSize) < t.lightWeightDisplayMinPx && Number.parseFloat(css.fontWeight) < t.lightWeightFloor) add('CF-109', 'MEDIUM', 'measured', el, [css.fontSize, css.fontWeight], 'weight >=400 under 18px; weight <300 only at >=28px');
      if (css.textTransform === 'uppercase' && text.length > t.uppercaseLongLabelChars && !cjk(text) && !el.children.length) add('SLOP-020', 'LOW', 'measured', el, text.length, t.uppercaseLongLabelChars);
      if (/^\d[\d,.%+\-\s]*$/u.test(text) && el.closest('td,[role="cell"],[role="gridcell"],[aria-live],.kpi,.metric')) {
        const family = css.fontFamily.toLowerCase();
        if (!/mono/u.test(family) && !/tabular-nums/u.test(css.fontVariantNumeric) && !/["'](?:tnum|lnum)["']\s*1/u.test(css.fontFeatureSettings)) add('CF-106', 'LOW', 'measured', el, css.fontVariantNumeric, 'tabular numerals');
      }
      const rects = textRects(el);
      const clipped = rects.some((r) => {
        if (r.left < -t.clippedTextTolerancePx || r.right > innerWidth + t.clippedTextTolerancePx) return true;
        for (let parent = el; parent; parent = parent.parentElement) {
          const pc = getComputedStyle(parent);
          if (!/(hidden|clip)/u.test(`${pc.overflowX} ${pc.overflowY}`) || pc.textOverflow === 'ellipsis' || Number.parseInt(pc.webkitLineClamp, 10) > 0 || Number.parseInt(pc.lineClamp, 10) > 0) continue;
          const p = parent.getBoundingClientRect(), tol = t.clippedTextTolerancePx;
          if (r.left < p.left - tol || r.right > p.right + tol || r.top < p.top - tol || r.bottom > p.bottom + tol) return true;
        }
        return false;
      });
      if (clipped) {
        add('RS-007', /^(H[1-6]|P|LI|BLOCKQUOTE)$/u.test(el.tagName) ? 'HIGH' : 'MEDIUM', 'measured', el, 'clipped text', 'fully visible');
        if (state.zoomEmulation) add('RS-004', 'HIGH', 'derived', el, 'clipped text', 'fully visible');
      }
      const bg = background(el), fg = color(css.color), r = box;
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)), Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)));
      const obscured = hit && hit !== el && !el.contains(hit) && !hit.contains(el);
      if (!el.closest(':disabled,[aria-disabled="true"]') && bg && fg && !obscured) {
        const painted = fg.c.map((v, i) => v * fg.a + bg[i] * (1 - fg.a)), value = contrast(painted, bg);
        const size = Number.parseFloat(css.fontSize), large = size >= t.largeTextPx || (size >= t.boldLargeTextPx && Number.parseFloat(css.fontWeight) >= 700);
        const floor = large ? t.largeTextContrast : t.smallTextContrast;
        if (value < floor) add('CF-201', large ? 'MEDIUM' : 'HIGH', 'derived', el, Number(value.toFixed(2)), floor);
      } else if (!el.closest(':disabled,[aria-disabled="true"]')) {
        const stops = !obscured && fg ? gradientStops(el) : [];
        if (stops.length) {
          const size = Number.parseFloat(css.fontSize), large = size >= t.largeTextPx || size >= t.boldLargeTextPx && Number.parseFloat(css.fontWeight) >= 700;
          const floor = large ? t.largeTextContrast : t.smallTextContrast;
          const worst = Math.min(...stops.map((stop) => contrast(fg.c, stop.c)));
          if (worst < floor) add('CF-204', 'HIGH', 'derived', el, Number(worst.toFixed(2)), floor);
        } else unverified(obscured ? 'CF-201' : 'CF-204', obscured ? `overlapping layer at ${id(el)}` : `paint behind ${id(el)} could not be sampled`);
      }
      const prose = /^(P|BLOCKQUOTE|DD|LI|TD)$/u.test(el.tagName) && text.length >= 80 && !el.closest('nav,footer,[role="ticker"],marquee');
      if (prose && rects.length >= 2) {
        const size = Number.parseFloat(css.fontSize), isCjk = cjk(text), leading = css.lineHeight === 'normal' ? null : Number.parseFloat(css.lineHeight) / size;
        const floor = isCjk ? t.bodyLineHeightMinCjk : t.bodyLineHeightMinLatin;
        if (leading !== null && leading < floor) add('CF-103', 'MEDIUM', 'derived', el, Number(leading.toFixed(2)), floor);
        if (rects.length >= 3 && leading !== null && leading < t.wrappedRowLineHeightMin) add('CF-104', 'MEDIUM', 'derived', el, Number(leading.toFixed(2)), t.wrappedRowLineHeightMin);
        const measure = Math.round(text.length * Math.max(...rects.map((r) => r.width)) / Math.max(1, rects.reduce((sum, r) => sum + r.width, 0))), max = isCjk ? t.bodyMeasureMaxCjkCh : t.bodyMeasureMaxLatinCh;
        if (measure > max) add('CF-101', 'MEDIUM', 'derived', el, Math.round(measure), max);
      }
      if (/^H[1-6]$/u.test(el.tagName) && rects.length >= 2 && css.lineHeight !== 'normal') {
        const size = Number.parseFloat(css.fontSize), leading = Number.parseFloat(css.lineHeight) / size;
        const floor = size >= t.displayHeadingMinPx ? t.displayHeadingLineHeightMin : t.headingLineHeightMin;
        if (leading < floor || leading > t.headingLineHeightMax) add('CF-102', 'MEDIUM', 'derived', el, Number(leading.toFixed(2)), [floor, t.headingLineHeightMax]);
      }
      const flourishDashes = text.match(/—|(?<=\s)–(?=\s)/gu);
      if (flourishDashes) add('SLOP-040', 'MEDIUM', 'measured', el, flourishDashes.length, 0);
      if (/\b(?:unleash|revolutionize|transformative platform|seamless experience|next.gen)\b/iu.test(text)) add('SLOP-036', 'MEDIUM', 'measured', el, text.slice(0, 120), 'specific claim');
      if (/\b(?:lorem ipsum|\[placeholder\]|\[todo\]|todo:)\b/iu.test(text)) add('SLOP-060', 'LOW', 'measured', el, text.slice(0, 120), 'finished copy');
      if (el.matches('button,a,label,[role="button"],nav *') && /^\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+)+$/u.test(text) && !/\bExample\b/u.test(text)) add('CF-107', 'LOW', 'derived', el, text, 'sentence case');
      if (el.nextElementSibling?.matches('h1,h2,h3') && css.textTransform === 'uppercase' && Number.parseFloat(css.letterSpacing) > 0 && Number.parseFloat(css.fontSize) < Number.parseFloat(getComputedStyle(el.nextElementSibling).fontSize) * .65) eyebrows.push(el);
      if (el.matches('button,a,[role="button"]') && /^[\p{Extended_Pictographic}\uFE0F\s]+$/u.test(text) && box.width <= 32) add('SLOP-053', 'LOW', 'derived', el, text, 'named icon set');
    }
    if (el.matches('input:not([type]),input:is([type="text"],[type="email"],[type="number"],[type="password"],[type="search"],[type="tel"],[type="url"]),textarea,select,[contenteditable]:not([contenteditable="false"])') && innerWidth <= t.touchViewportMaxPx && Number.parseFloat(css.fontSize) < t.mobileInputFontMinPx) add('RS-008', 'MEDIUM', 'measured', el, Number.parseFloat(css.fontSize), t.mobileInputFontMinPx);
    if (el.matches('input[placeholder],textarea[placeholder]')) {
      const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      if (!name) add('CF-806', 'MEDIUM', 'measured', el, 'placeholder only', 'persistent label');
      const fg = color(getComputedStyle(el, '::placeholder').color), bg = background(el);
      if (fg && bg) { const value = contrast(fg.c, bg); if (value < t.smallTextContrast) add('CF-807', 'MEDIUM', 'derived', el, Number(value.toFixed(2)), t.smallTextContrast); }
    }
    if (el.matches('a[href]') && /^(#|javascript:)/iu.test(el.getAttribute('href')?.trim() ?? '')) add('SLOP-058', el.closest('nav') || el.classList.contains('primary') ? 'HIGH' : 'MEDIUM', 'derived', el, el.getAttribute('href'), 'real destination');
    if (el.matches('button:not([type])') && el.form && [...el.form.querySelectorAll('button,input[type="submit"],input[type="image"]'), ...document.querySelectorAll(`button[form="${CSS.escape(el.form.id)}"]`)].filter((button) => button.form === el.form && (button.matches('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]'))).length >= 2) add('SLOP-059', 'HIGH', 'derived', el, 'implicit submit among submit-capable controls', 'explicit button or submit');
    if (el.matches('img')) {
      const source = el.getAttribute('src') || el.getAttribute('srcset');
      if (!source || /^(#|undefined)$/iu.test(source)) add('SLOP-057', 'HIGH', 'derived', el, source, 'decodable source');
      else if (el.loading === 'lazy' && !el.complete) unverified('SLOP-057', `lazy image at ${id(el)} has not loaded`);
      else if (el.complete && el.naturalWidth === 0) add('SLOP-057', 'HIGH', 'measured', el, source, 'decodable source');
    }
    if (isTarget(el)) {
      targets.push(el);
      const inline = el.matches('a') && /^(P|LI)$/u.test(el.parentElement?.tagName ?? '') && el.parentElement.childNodes.length > 1;
      if (!inline) {
        const min = Math.min(box.width, box.height), primary = el === firstFilled || el.matches('button[type="submit"]') && el.form?.querySelectorAll('button[type="submit"]').length === 1;
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        const spaced = elements.filter((other) => other !== el && isTarget(other)).every((other) => { const r = other.getBoundingClientRect(); const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom); const ox = r.left + r.width / 2, oy = r.top + r.height / 2; return Math.hypot(dx, dy) >= t.hitAreaFloorPx / 2 && Math.hypot(cx - ox, cy - oy) >= t.hitAreaFloorPx; });
        if (min < t.hitAreaFloorPx && !spaced) add('CF-701', 'HIGH', 'measured', el, [Math.round(box.width), Math.round(box.height)], [t.hitAreaFloorPx, t.hitAreaFloorPx]);
        else if (innerWidth <= t.touchViewportMaxPx && min < t.touchHitAreaPx && min >= t.hitAreaFloorPx) add('CF-701', primary ? 'HIGH' : 'MEDIUM', 'measured', el, [Math.round(box.width), Math.round(box.height)], [t.touchHitAreaPx, t.touchHitAreaPx]);
        if (destructive.test(`${text} ${el.getAttribute('aria-label') ?? ''}`) && min < t.touchHitAreaPx) add('CF-703', 'HIGH', 'measured', el, [Math.round(box.width), Math.round(box.height)], [t.touchHitAreaPx, t.touchHitAreaPx]);
      }
      const labelledBy = el.getAttribute('aria-labelledby')?.split(/\s+/u).map((key) => document.getElementById(key)?.textContent?.trim() ?? '').join(' ').trim();
      const accessibleName = el.getAttribute('aria-label')?.trim() || labelledBy || el.getAttribute('title')?.trim() || el.innerText?.trim() || el.querySelector('img[alt]')?.getAttribute('alt')?.trim() || el.labels?.[0]?.textContent?.trim() || el.getAttribute('value')?.trim();
      if (!accessibleName && !el.matches('input[type="hidden"]')) add('CF-603', 'HIGH', 'derived', el, 'no accessible name', 'accessible name');
    }
    if ((css.backgroundClip === 'text' || css.webkitBackgroundClip === 'text') && /gradient\(/iu.test(css.backgroundImage)) add('SLOP-009', 'MEDIUM', 'measured', el, css.backgroundImage.slice(0, 100), 'solid text');
    if (/repeating-(?:linear|radial)-gradient/iu.test(css.backgroundImage) && !el.closest('figure,[role="img"]') && !el.querySelector('canvas,svg,table')) {
      const section = el.closest('section') ?? el;
      if (section.querySelector('[class*="blob"],[class*="halo"]') || /(?:rgb|hsl)a?\([^)]*(?:22\d|2[3-7]\d)/iu.test(css.backgroundImage)) add('SLOP-012', 'MEDIUM', 'derived', el, css.backgroundImage.slice(0, 100), 'data-linked grid');
    }
    if (el.matches('dialog,[role="dialog"],.modal') && /blur\(/iu.test(getComputedStyle(el, '::backdrop').backdropFilter || css.backdropFilter)) add('CF-406', 'LOW', 'measured', el, 'blurred scrim', 'solid scrim');
    if (css.willChange !== 'auto') {
      const props = css.willChange.split(',').map((v) => v.trim());
      if (props.some((v) => !['transform', 'opacity', 'filter'].includes(v))) add('CF-507', 'LOW', 'measured', el, css.willChange, 'transform, opacity or filter');
      else if (!el.getAnimations().some((a) => a.playState === 'running')) add('CF-507', 'MEDIUM', 'measured', el, css.willChange, 'only while animation runs');
    }
    if (el.parentElement && css.borderRadius !== '0px') {
      const p = el.parentElement, pc = getComputedStyle(p), pr = p.getBoundingClientRect(), pad = Number.parseFloat(pc.paddingLeft);
      if (pad <= t.concentricParentPaddingMaxPx && Math.abs(pr.width - box.width - 2 * pad) < 3) {
        const outer = Number.parseFloat(pc.borderTopLeftRadius), inner = Number.parseFloat(css.borderTopLeftRadius);
        if (outer > 0 && Math.abs(inner - Math.max(0, outer - pad)) > t.concentricRadiusTolerancePx) add('CF-401', 'LOW', 'derived', el, inner, outer - pad);
      }
    }
    if (el.matches('button[type="submit"],.primary,[data-primary="true"]') && css.boxShadow !== 'none') {
      const m = css.boxShadow.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/u), shade = color(css.boxShadow);
      if (m && shade && Number(m[3]) >= t.glowBlurMinPx && hsl(shade.c).s > t.glowSaturationMin) { add('CF-404', 'MEDIUM', 'derived', el, css.boxShadow, `blur below ${t.glowBlurMinPx}px`); if (Math.abs(Number(m[1])) <= 1 && Math.abs(Number(m[2])) <= 1) glows.push(el); }
    }
    if (Number.parseFloat(css.borderTopLeftRadius) > 0 && !el.matches('[role="alert"],[role="note"],.callout,.admonition')) {
      const border = [css.borderLeftColor, css.borderTopColor].map(color).filter(Boolean).some((c) => hsl(c.c).s > .35);
      const inset = /inset\s+\d+px\s+0px\s+0px/iu.test(css.boxShadow);
      if (inset || border && (Number.parseFloat(css.borderLeftWidth) >= 3 || Number.parseFloat(css.borderTopWidth) >= 3)) stripes.push({ el, inset });
    }
    if (el.matches('button,.primary,[data-accent],.active') && !el.matches('[role="status"],[role="alert"],.success,.warning,.error,.danger,.status') && box.width >= t.accentSurfaceMinPx && box.height >= t.accentSurfaceMinPx) {
      const fill = color(css.backgroundColor); if (fill && hsl(fill.c).s > .4) hues.push(hsl(fill.c).h);
    }
    if (/^H[1-3]$/u.test(el.tagName) || Number.parseFloat(css.fontSize) >= 20 || /gradient\(/iu.test(css.backgroundImage)) for (const sample of [/gradient\(/iu.test(css.backgroundImage) ? null : color(css.color), ...gradientStops(el)]) {
      if (sample && Math.max(...sample.c) - Math.min(...sample.c) >= t.bannedAccentSpreadMin) accentSamples.push({ el, hue: hsl(sample.c).h });
    }
    if (el.matches('marquee')) add('SLOP-061', 'LOW', 'measured', el, 'marquee element', 'static or pausable content');
    if (el.matches('section,main,article,[class*="card"]') && !isTarget(el)) for (const key of ['marginTop','marginBottom','paddingTop','paddingBottom','gap','rowGap','columnGap']) {
      const value = Number.parseFloat(css[key]); if (value >= 4 && Number.isFinite(value)) spacing.push({ el, value });
    }
  }
  if (fontFamilies.size > t.fontFamilyMax) add('SLOP-019', 'MEDIUM', 'derived', null, [...fontFamilies], t.fontFamilyMax);
  if (viewport === '390' && roles.size > t.typeRoleMax) add('CF-108', 'MEDIUM', 'derived', null, [...roles], t.typeRoleMax);
  if (glows.length >= t.glowRepeatMin) add('SLOP-010', 'MEDIUM', 'derived', glows[0], glows.length, 1);
  if (stripes.some((row) => row.inset) || stripes.length >= t.stripeRepeatMin) add('SLOP-015', 'MEDIUM', 'derived', stripes[0].el, stripes.length, 'no decorative stripe');
  const sections = elements.filter((el) => el.tagName === 'SECTION');
  for (const heading of elements.filter((el) => /^H[1-6]$/u.test(el.tagName))) {
    let anchor = heading, previous = null;
    while (anchor && anchor !== document.body && !previous) {
      previous = [...(anchor.parentElement?.children ?? [])].slice(0, [...anchor.parentElement.children].indexOf(anchor)).reverse().find((el) => visible(el) && !['absolute', 'fixed'].includes(getComputedStyle(el).position)) ?? null;
      if (previous) break;
      const parent = anchor.parentElement, css = getComputedStyle(parent);
      if (parent === document.body || color(css.backgroundColor)?.a > 0 || Number.parseFloat(css.borderTopWidth) > 0 || css.boxShadow !== 'none') break;
      anchor = parent;
    }
    const next = [...heading.parentElement.children].slice([...heading.parentElement.children].indexOf(heading) + 1).find((el) => visible(el) && !['absolute', 'fixed'].includes(getComputedStyle(el).position));
    if (!previous || !next) continue;
    const above = heading.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
    const below = next.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
    if (above < t.headingAboveRatioMin * below && below - above >= t.headingDeficitMinPx) add('CF-304', 'LOW', 'measured', heading, [Number(above.toFixed(1)), Number(below.toFixed(1))], `above >= ${t.headingAboveRatioMin} * below or deficit <${t.headingDeficitMinPx}px`);
  }
  const h2Count = elements.filter((el) => el.tagName === 'H2').length;
  if (h2Count && eyebrows.length > Math.ceil(h2Count / 3)) add('SLOP-029', 'MEDIUM', 'derived', eyebrows[0], eyebrows.length, Math.ceil(h2Count / 3));
  for (const grid of elements.filter((el) => el.matches('[class*="grid"],[style*="grid"]'))) {
    const section = grid.closest('section,main,article') ?? document.body;
    const cards = [...grid.children].filter(visible);
    if (cards.length < t.tileCountMin || grid.closest('ul,ol,table')) continue;
    const boxes = cards.map((card) => card.getBoundingClientRect());
    if (boxes.every((box) => Math.abs(box.width - boxes[0].width) <= t.tileBoxTolerancePx && Math.abs(box.height - boxes[0].height) <= t.tileBoxTolerancePx) && cards.every((card) => card.querySelector('svg,img') && card.querySelector('h2,h3,h4') && card.querySelector('p'))) tileGrids.push(grid);
    const stats = cards.filter((card) => /^\s*[\d,.]+\s*[%+]?\s*$/u.test(card.querySelector('strong,b,[class*="value"]')?.textContent ?? '') && card.querySelector('small,p,span'));
    const minStats = section.querySelector('a[href],button') ? t.statSiblingMarketingMin : t.statSiblingMin;
    if (stats.length >= minStats && !grid.closest('[data-source],[data-metric-source]') && !grid.querySelector('cite,[href*="source"],[href*="data"]')) add('SLOP-045', 'MEDIUM', 'derived', grid, stats.length, 'candidate; reviewer confirms ornamental statistics');
  }
  if (tileGrids.length >= t.tileGridRepeatMin) add('SLOP-002', 'MEDIUM', 'derived', tileGrids[0], tileGrids.length, 1);
  const offScale = spacing.filter(({ value }) => Math.min(value % t.spacingStepPx, t.spacingStepPx - value % t.spacingStepPx) > t.spacingTolerancePx);
  const distinctOffScale = [...new Set(offScale.map(({ value }) => Math.round(value)))];
  if (offScale.length) add('CF-301', distinctOffScale.length > t.spacingMediumDistinctCount ? 'MEDIUM' : 'LOW', 'measured', offScale[0].el, distinctOffScale.slice(0, 8), `multiple of ${t.spacingStepPx}px ±${t.spacingTolerancePx}px`);
  const coarse = innerWidth <= t.touchViewportMaxPx;
  for (let i = 0; i < Math.min(targets.length, 160); i++) for (let j = i + 1; j < Math.min(targets.length, 160); j++) {
    const a = targets[i], b = targets[j];
    if (a.contains(b) || b.contains(a) || a.parentElement !== b.parentElement) continue;
    const gap = clearGap(a.getBoundingClientRect(), b.getBoundingClientRect());
    const floor = coarse ? t.coarseTargetGapPx : t.fineTargetGapPx;
    if (gap < floor) add('CF-702', 'MEDIUM', 'measured', b, Number(gap.toFixed(1)), floor);
  }
  for (const parent of elements.filter((el) => el.matches('main,section,article,[class*="group"],[class*="stack"]')).slice(0, 100)) {
    const children = [...parent.children].filter((el) => visible(el) && !isTarget(el) && el.getBoundingClientRect().height >= 8);
    const gaps = [];
    for (let i = 1; i < children.length; i++) {
      const a = children[i - 1], b = children[i], ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (Math.abs(ra.left - rb.left) > Math.min(ra.width, rb.width) * .5) continue;
      const gap = rb.top - ra.bottom;
      if (gap < 0 || gap > innerHeight) continue;
      gaps.push(gap);
      const ca = getComputedStyle(a), cb = getComputedStyle(b);
      const painted = [ca, cb].some((css) => css.backgroundColor !== 'rgba(0, 0, 0, 0)' || Number.parseFloat(css.borderTopWidth) > 0);
      const floor = painted ? t.borderedBlockGapPx : t.borderlessBlockGapPx;
      if (gap < floor && !a.contains(b) && !b.contains(a)) add('CF-303', 'MEDIUM', 'measured', b, Number(gap.toFixed(1)), floor);
    }
    if (gaps.length >= 3) {
      const sorted = [...gaps].sort((a, b) => a - b), middle = sorted[Math.floor(sorted.length / 2)];
      const boundary = sorted.find((gap) => gap > middle * t.groupBoundaryCandidateRatio && gap < middle * t.groupRatioMin);
      if (boundary) add('CF-302', 'MEDIUM', 'derived', parent, Number((boundary / Math.max(1, middle)).toFixed(2)), t.groupRatioMin);
    }
  }
  for (const target of targets.filter((el) => !el.matches(':disabled,[aria-disabled="true"]')).slice(0, 12)) {
    const snapshot = () => { const css = getComputedStyle(target); return { outline: css.outline, outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle, outlineColor: css.outlineColor, shadow: css.boxShadow, border: css.borderColor, background: css.backgroundColor }; };
    const before = snapshot();
    target.focus({ preventScroll: true });
    if (!target.matches(':focus-visible')) { unverified('CF-202', `native focus-visible did not match ${id(target)}`); target.blur(); continue; }
    const after = snapshot(); target.blur();
    if (['outline', 'shadow', 'border', 'background'].every((key) => before[key] === after[key])) add('CF-202', 'HIGH', 'measured', target, 'no visible state change', 'visible focus indicator');
    else if (after.outlineStyle !== 'auto') {
      const width = Number.parseFloat(after.outlineWidth), ring = color(after.outlineColor), bg = background(target.parentElement ?? target);
      if (width < t.focusOutlineMinPx && after.shadow === 'none') add('CF-202', 'MEDIUM', 'measured', target, width, t.focusOutlineMinPx);
      else if (ring && bg && width >= t.focusOutlineMinPx && contrast(ring.c, bg) < t.focusContrastMin) add('CF-202', 'MEDIUM', 'derived', target, Number(contrast(ring.c, bg).toFixed(2)), t.focusContrastMin);
    }
  }
  const clusters = [];
  for (const hue of hues) if (!clusters.some((v) => Math.min(Math.abs(hue - v), 360 - Math.abs(hue - v)) <= t.accentHueToleranceDegrees)) clusters.push(hue);
  if (clusters.length > 1) add('CF-205', 'MEDIUM', 'derived', null, clusters.length, 1, 'review separate status colours');
  const banned = accentSamples.filter((sample) => sample.hue >= t.bannedAccentHueMin && sample.hue <= t.bannedAccentHueMax);
  if (banned.length && new Set(banned.map((sample) => sample.el.closest('section') ?? sample.el.closest('main') ?? sample.el)).size < 2) add('SLOP-008', 'MEDIUM', 'derived', banned[0].el, Number(banned[0].hue.toFixed(1)), 'brand-consistent hue or alternate accent');
  for (let i = 0; i < Math.min(textElements.length, 150); i++) for (let j = i + 1; j < Math.min(textElements.length, 150); j++) {
    const a = textElements[i], b = textElements[j]; if (a.contains(b) || b.contains(a)) continue;
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    const area = Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) * Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
    if (area / Math.max(1, Math.min(x.width * x.height, y.width * y.height)) >= t.overlapAreaRatio) add('RS-007', 'MEDIUM', 'measured', b, Number(area.toFixed(1)), `< ${t.overlapAreaRatio} overlap ratio`);
  }
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { unverified('*', 'cross-origin stylesheet'); continue; }
    for (const rule of rules) {
      const source = rule.cssText ?? '';
      if (rule.type === CSSRule.KEYFRAMES_RULE) {
        const start = [...rule.cssRules].find((v) => v.keyText === 'from' || v.keyText === '0%');
        const m = start?.style.transform?.match(/scale(?:3d|X|Y)?\(\s*([\d.]+)/iu);
        if (m && Number(m[1]) < t.entranceScaleMin) add('CF-503', document.getAnimations().some((animation) => animation.playState === 'running' && animation.animationName === rule.name) ? 'MEDIUM' : 'LOW', 'derived', null, Number(m[1]), t.entranceScaleMin, rule.name);
      }
      if (/transition(?:-property)?\s*:[^;]*(?:width|height|padding|margin|top|left)/iu.test(source)) add('CF-508', 'MEDIUM', 'measured', null, source.slice(0, 160), 'transform or opacity');
      if (/cubic-bezier\([^)]*(?:-0\.|1\.[2-9])|\b(?:bounce|elastic)\b/iu.test(source)) add('CF-505', 'MEDIUM', 'derived', null, source.slice(0, 160), 'non-overshooting easing');
      if (rule.selectorText?.includes(':hover') && /(?:opacity\s*:\s*1(?:\D|$)|visibility\s*:\s*visible|display\s*:\s*(?!none)\w+)/iu.test(source)) {
        const target = rule.selectorText.split(':hover').at(-1).trim();
        const hidden = target && [...rules].some((peer) => peer.selectorText?.trim() === target && /(?:opacity\s*:\s*0(?:\D|$)|visibility\s*:\s*hidden|display\s*:\s*none)/iu.test(peer.cssText ?? ''));
        const keyboard = [...rules].some((peer) => /:focus-within|:focus-visible/u.test(peer.selectorText ?? '') && peer.selectorText.split(/:focus-(?:within|visible)/u).at(-1).trim() === target);
        if (hidden && !keyboard) add('CF-704', 'HIGH', 'derived', null, rule.selectorText, 'matching focus reveal');
      }
    }
  }
  if (state.reducedMotion) {
    const videos = [...document.querySelectorAll('video')].filter((v) => !v.paused).length;
    const motionKeys = /^(?:transform|translate|scale|rotate|top|right|bottom|left|inset|width|height|margin|offset|backgroundPosition|all)/u;
    const motion = document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration) > t.reducedMotionMaxMs && !a.effect?.target?.closest('progress,[role="progressbar"],[role="status"],[aria-busy="true"]') && a.effect?.getKeyframes().some((frame) => Object.keys(frame).some((key) => motionKeys.test(key)))).length;
    const declaredMotion = elements.filter((el) => !el.closest('progress,[role="progressbar"],[role="status"],[aria-busy="true"]')).filter((el) => { const css = getComputedStyle(el); const properties = css.transitionProperty.split(',').map((v) => v.trim()); const durations = css.transitionDuration.split(',').map((v) => v.trim().endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000); return properties.some((property, index) => /^(?:transform|translate|scale|rotate|top|right|bottom|left|inset|width|height|margin|offset|background-position|all)/u.test(property) && (durations[index % durations.length] ?? 0) > t.reducedMotionMaxMs); }).length;
    if (videos || motion || declaredMotion) add('RS-003', 'HIGH', 'measured', null, { videos, motion, declaredMotion }, 0);
  }
  if (state.scheme === 'dark') { const bg = background(document.body); if (bg && luminance(bg) >= .35) { const toggle = elements.find((el) => isTarget(el) && /(?:theme|dark|light|appearance|mode)/iu.test(`${el.id} ${el.className} ${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`)); if (toggle) unverified('RS-002', `in-page theme control ${id(toggle)} was not activated`); else add('RS-002', 'MEDIUM', 'derived', document.body, Number(luminance(bg).toFixed(2)), '<0.35'); } }
  const hoverSelectors = targets.filter((el) => el.parentElement && [...el.parentElement.children].filter(isTarget).length >= 3).slice(0, 5).map(path);
  return { viewport, findings, notVerified, hoverSelectors, readyState: document.readyState };
}
