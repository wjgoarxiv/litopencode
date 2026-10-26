import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { paletteFromTheme } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { adhdBreakMs, adhdSuggestDue, wayBackDue } from "../src/tui/mission-source.ts";
import { rainbowAt, rainbowLingerMs, rainbowShows, relativeLuminance } from "../src/tui/mission-rainbow.ts";

const now = Date.parse("2026-10-26T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const figures = { contextPercent: 3, inLane: false };
const adhd = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-adhd" }], todos: [], now });

test("the rewind look outlasts the brief: it holds until the next prompt, at most fifteen minutes", () => {
  assert.equal(rainbowShows(true, undefined, undefined, now), true, "while lit-adhd runs");
  const seen = now - 3 * 60_000;
  assert.equal(rainbowShows(false, seen, seen - 10_000, now), true, "the turn ended and the user is reading the brief");
  assert.equal(rainbowShows(false, seen, seen + 60_000, now), false, "the next prompt ends it");
  assert.equal(rainbowShows(false, now - rainbowLingerMs - 1, undefined, now), false, "fifteen minutes ends it");
  assert.equal(rainbowShows(false, undefined, undefined, now), false, "never seen, never shown");
});

test("the rewind card names itself: a per-letter REWIND mark and a sparkle trail at one brightness", () => {
  const frame = restingFrameFor(adhd, now);
  const top = statusCard({ view: adhd, frame, chips: [], busy: false, figures, rainbow: rainbowAt(now) }, palette, 100)[0];
  const letters = top.filter((segment) => segment.bg === undefined && /^[REWIND]$/u.test(segment.text));
  assert.equal(letters.map((segment) => segment.text).join(""), "REWIND", "one segment per letter");
  assert.equal(new Set(letters.map((segment) => segment.fg)).size, 6, "every letter takes its own hue");
  const levels = letters.map((segment) => relativeLuminance(segment.fg));
  assert.ok(Math.max(...levels) - Math.min(...levels) < 0.12, "the letters differ in hue, not in brightness");
  assert.ok(top.some((segment) => /[✦✧⋆]/u.test(segment.text)), "a sparkle trail rides the top border");
  const later = statusCard({ view: adhd, frame, chips: [], busy: false, figures, rainbow: rainbowAt(now + 250) }, palette, 100)[0];
  const sparkle = (line) => line.filter((segment) => /[✦✧⋆·]/u.test(segment.text)).map((segment) => segment.text).join("");
  assert.notEqual(sparkle(later), sparkle(top), "the trail moves with the tick");
  const plain = statusCard({ view: adhd, frame, chips: [], busy: false, figures }, palette, 100)[0];
  assert.equal(plain.map((segment) => segment.text).join("").includes("REWIND"), false, "no mark without the rewind look");
  for (const line of [top, plain]) assert.equal(line.reduce((sum, segment) => sum + [...segment.text].length, 0) > 0, true);
});

test("the way back in is offered after a break, not all the time", () => {
  assert.equal(wayBackDue(undefined, now, true), true, "a fresh session in a workspace with earlier work");
  assert.equal(wayBackDue(now - adhdBreakMs, now, true), true, "thirty minutes since the last message");
  assert.equal(wayBackDue(now - 5 * 60_000, now, true), false, "the user is mid-work");
  assert.equal(wayBackDue(undefined, now, false), false, "nothing earlier to go back to");
});

test("the start suggestion comes once a day per workspace", () => {
  const day = new Map();
  assert.equal(adhdSuggestDue(day, "/w", now), true);
  assert.equal(adhdSuggestDue(day, "/w", now + 60_000), false, "a second session the same day stays quiet");
  assert.equal(adhdSuggestDue(day, "/other", now + 60_000), true, "another workspace is its own day");
  assert.equal(adhdSuggestDue(day, "/w", now + 25 * 60 * 60_000), true, "the next day may suggest again");
});

test("lit-handoff points to lit-adhd for picking several sessions back up", () => {
  const skill = readFileSync(new URL("../skills/lit-handoff/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /lit-adhd/u);
});
