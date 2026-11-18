#!/usr/bin/env node
// The cost line of the ultra-brainstorm launch question: idea lanes, one reducer per 30 lanes and one judge, plus
// this session's own cost of dispatching each lane (it re-reads its context once per lane, which is most of the bill).
// Calibrated from one real 100-lane OpenCode 2 run (4.88M tokens in all: lead 4.37M, lanes 0.39M, 4 reducers 0.10M,
// judge 0.02M). Per-lane figures count only the 51 lanes that answered; the range is a planning figure, never a bill.
// Usage: node estimate.mjs <lanes> [--json] | node estimate.mjs --answer <<'LIT_REPLY_END_9Q7' (the reply on stdin, never as an argument)
// The reply is user text: it reaches this script only through stdin from a quoted heredoc, so no shell expands it.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** [low, high] tokens per unit. */
export const IDEA_TOKENS = Object.freeze([3_700, 5_200]);
export const LEAD_PER_LANE_TOKENS = Object.freeze([30_000, 60_000]);
export const REDUCER_TOKENS = Object.freeze([19_800, 28_900]);
export const JUDGE_TOKENS = Object.freeze([24_500, 40_000]);
export const PER_REDUCER = 30;
export const MAX_LANES = 900;

export function estimate(lanes) {
  if (!Number.isInteger(lanes) || lanes < 1) throw new Error("lanes must be a positive whole number");
  if (lanes > MAX_LANES) throw new Error(`at most ${MAX_LANES} idea lanes per run; split a larger run`);
  const reducers = Math.ceil(lanes / PER_REDUCER);
  const at = (i) => lanes * (IDEA_TOKENS[i] + LEAD_PER_LANE_TOKENS[i]) + reducers * REDUCER_TOKENS[i] + JUDGE_TOKENS[i];
  return { lanes, reducers, judges: 1, tokensLow: at(0), tokensHigh: at(1) };
}

export function costLine(lanes) {
  const { reducers, tokensLow, tokensHigh } = estimate(lanes);
  const m = (tokens) => (tokens / 1_000_000).toFixed(1);
  return `${lanes} idea lanes (lit-ideator: helper route, lowest effort) + ${reducers} reducers (lit-explorer: helper route) + 1 judge (lit-oracle: lead route) ≈ ${m(tokensLow)}–${m(tokensHigh)}M tokens, most of it this session re-reading its context once per lane`;
}

/**
 * Reads the launch answer. A question dialog may hand back the picked option's whole label, such as
 * `(Recommended) 100 (recommended minimum)` or `300명 (Recommended)`, so the count is the one number in it.
 * A plain no stops; no number, two different numbers or one over the cap asks again.
 */
export function parseLaunchAnswer(text) {
  const answer = String(text).trim().toLowerCase().replace(/[.!]+$/u, "");
  if (/^(?:no|stop|cancel|아니|아니요|아니오|취소)$/u.test(answer)) return { answer: "stop" };
  const counts = [...new Set([...answer.matchAll(/\d[\d,]*/gu)].map((match) => Number(match[0].replace(/,/gu, ""))))];
  if (counts.length === 0) return { answer: "ask", reason: "no count" };
  if (counts.length > 1) return { answer: "ask", reason: "more than one count" };
  const lanes = counts[0];
  if (!Number.isInteger(lanes) || lanes < 1) return { answer: "ask", reason: "no count" };
  if (lanes > MAX_LANES) return { answer: "ask", reason: `over ${MAX_LANES}` };
  return { answer: "launch", lanes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [raw, flag] = process.argv.slice(2);
  if (raw === "--answer" && process.argv.length > 3) {
    process.stderr.write("estimate: unknown argument after --answer; the reply goes in on stdin only\n");
    process.exitCode = 64;
  } else if (raw === "--answer") {
    process.stdout.write(`${JSON.stringify(parseLaunchAnswer(readFileSync(0, "utf8")))}\n`);
  } else {
    try {
      const lanes = Number(raw);
      process.stdout.write(`${flag === "--json" ? JSON.stringify(estimate(lanes)) : costLine(lanes)}\n`);
    } catch (error) {
      process.stderr.write(`estimate: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 64;
    }
  }
}
