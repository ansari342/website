import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hillClimb, riskAdjusted } from "../trading/lib/hillclimb.js";
import { walkForward, filteredDipStrategy, probabilityStrategy } from "../trading/lib/daytrade.js";
import { runBacktest } from "../trading/lib/engine.js";

test("hill climbing finds the top of a simple hill, and restarts escape a small one", () => {
  const space = { a: [0, 1, 2, 3, 4, 5, 6, 7, 8], b: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  const score = ({ a, b }) => -((a - 6) ** 2) - (b - 2) ** 2;
  const { best } = hillClimb({ space, start: { a: 0, b: 8 }, score, restarts: 0 });
  assert.deepEqual(best.params, { a: 6, b: 2 });
  // Two hills: a small one near the start, a bigger one far away.
  const twoHills = ({ a }) => (a <= 2 ? 1 - Math.abs(a - 1) : 5 - Math.abs(a - 7));
  const stuck = hillClimb({ space: { a: space.a }, start: { a: 0 }, score: twoHills, restarts: 0 });
  assert.equal(stuck.best.params.a, 1);
  const freed = hillClimb({ space: { a: space.a }, start: { a: 0 }, score: twoHills, restarts: 6, seed: 3 });
  assert.equal(freed.best.params.a, 7);
});

test("the score rewards return per unit of drop and needs enough trades", () => {
  assert.equal(riskAdjusted({ cagr: 0.1, maxDrawdown: -0.2, trades: 50 }), 0.5);
  assert.ok(Math.abs(riskAdjusted({ cagr: 0.02, maxDrawdown: -0.01, trades: 50 }) - 0.2) < 1e-12); // tiny drops count as 10%
  assert.ok(riskAdjusted({ cagr: 0.5, maxDrawdown: -0.05, trades: 3 }) < -9); // too few trades
});

const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));

test("every filtered trade had a Dip Buyer signal and cleared the model's bar", () => {
  const syms = ["SPUS", "HLAL", "UMMA"];
  const series = Object.fromEntries(syms.map((s) => [s, load(s)]));
  const wf = walkForward(series, syms, { start: "2022-01-03" });
  const run = (threshold) => runBacktest({ series, symbols: syms, strategy: filteredDipStrategy(wf, { entryRsi: 15, trendLen: 200, maxPositions: 10, size: 0.1, threshold }), startDate: "2022-01-03", slippageBps: 5 });
  const open = run(0);
  const strict = run(0.7);
  assert.ok(open.trades.length > 20);
  assert.ok(strict.trades.length < open.trades.length);
  for (const t of strict.trades) {
    const s = series[t.sym];
    const i = s.d.indexOf(t.entryDate);
    const p = i - 1; // the signal comes from the previous close
    const avg200 = s.c.slice(p - 199, p + 1).reduce((a, b) => a + b, 0) / 200;
    assert.ok(s.c[p] > avg200, `${t.sym} ${t.entryDate} in uptrend`);
    assert.ok(wf.probs.get(t.entryDate).get(t.sym) >= 0.7, `${t.sym} ${t.entryDate} cleared the bar`);
    assert.match(t.entryReason, /^dip \+ \d+% chance$/);
  }
});

test("position size caps each buy and never exceeds the cash on hand", () => {
  const syms = ["SPUS", "HLAL", "UMMA"];
  const series = Object.fromEntries(syms.map((s) => [s, load(s)]));
  const wf = walkForward(series, syms, { start: "2023-01-03" });
  const r = runBacktest({ series, symbols: syms, strategy: probabilityStrategy(wf, { threshold: 0.55, maxPositions: 3, size: 0.6 }), startDate: "2023-01-03", slippageBps: 5 });
  assert.ok(r.trades.length > 10);
  assert.ok(r.exposure.every((x) => x <= 1 + 1e-9));
  assert.ok(r.equity.every((v) => v > 0));
});
