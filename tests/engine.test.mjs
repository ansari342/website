import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runBacktest } from "../trader/lib/engine.js";
import { STRATEGIES, dipBuyer } from "../trader/lib/strategies.js";
import { summarize, wilson, bootstrapYears } from "../trader/lib/stats.js";
import { sma, rsi } from "../trader/lib/indicators.js";
import { randomMarket } from "../trader/lib/data.js";

const load = (s) => JSON.parse(readFileSync(new URL(`../trader/data/${s}.json`, import.meta.url)));
const series = Object.fromEntries(["SPUS", "HLAL", "UMMA", "SPSK"].map((s) => [s, load(s)]));

// A tiny hand-made market.
const mk = (closes, opens = closes) => ({ d: closes.map((_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`), o: opens, h: closes.map((c, i) => Math.max(c, opens[i])), l: closes.map((c, i) => Math.min(c, opens[i])), c: closes, div: {} });

test("indicators", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const r = rsi([1, 2, 3, 4, 5, 6], 2);
  assert.equal(r.at(-1), 100);
});

test("orders placed at the close fill at the next open, never the same bar", () => {
  const s = mk([10, 10, 10, 10], [10, 12, 10, 10]);
  const once = { fields: [], onClose: (ctx) => (ctx.t === 0 ? [{ side: "buy", sym: "X", weight: 1 }] : ctx.t === 2 ? [{ side: "sell", sym: "X" }] : []) };
  const r = runBacktest({ series: { X: s }, symbols: ["X"], strategy: once, slippageBps: 0 });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].entryPrice, 12); // day 1 open, not day 0 close
  assert.equal(r.trades[0].exitPrice, 10); // day 3 open
});

test("cash only: buys never exceed available cash and equity never goes negative", () => {
  const greedy = { fields: [], onClose: (ctx) => ctx.symbols.map((s) => ({ side: "buy", sym: s, weight: 5 })) };
  const r = runBacktest({ series, symbols: ["SPUS", "HLAL", "UMMA"], strategy: greedy, startDate: "2022-01-10" });
  assert.ok(r.equity.every((v) => v > 0));
  assert.ok(r.exposure.every((x) => x <= 1 + 1e-9));
});

test("stops that gap through fill at the open", () => {
  const s = mk([100, 100, 80], [100, 100, 80]);
  const st = { fields: [], onClose: (ctx) => (ctx.t === 0 ? [{ side: "buy", sym: "X", weight: 1, stopPct: 0.05 }] : []) };
  const r = runBacktest({ series: { X: s }, symbols: ["X"], strategy: st, slippageBps: 0 });
  assert.equal(r.trades[0].exitReason, "stop (gap)");
  assert.equal(r.trades[0].exitPrice, 80);
});

test("all strategies run on real data and produce sane results", () => {
  for (const st of STRATEGIES) {
    const r = runBacktest({ series, symbols: ["SPUS", "HLAL", "UMMA"], strategy: st, startDate: "2022-06-01", benchmark: "SPUS" });
    const s = summarize(r);
    assert.equal(r.equity.length, r.dates.length);
    assert.ok(Number.isFinite(s.cagr) && s.maxDrawdown <= 0 && s.maxDrawdown > -1, st.id);
    assert.equal(r.benchmark.length, r.dates.length);
  }
});

test("results are deterministic", () => {
  const a = runBacktest({ series, symbols: ["SPUS", "HLAL"], strategy: dipBuyer, startDate: "2021-01-04" });
  const b = runBacktest({ series, symbols: ["SPUS", "HLAL"], strategy: dipBuyer, startDate: "2021-01-04" });
  assert.deepEqual(a.equity, b.equity);
});

test("probability helpers", () => {
  const [lo, hi] = wilson(70, 100);
  assert.ok(lo > 0.6 && lo < 0.61 && hi > 0.78 && hi < 0.79);
  const eq = Array.from({ length: 600 }, (_, i) => 100 * 1.0005 ** i);
  assert.equal(bootstrapYears(eq).pGain, 1);
});

test("random market is reproducible and well-formed", () => {
  const a = randomMarket(["SPUS", "SPSK"], 3, 300);
  const b = randomMarket(["SPUS", "SPSK"], 3, 300);
  assert.deepEqual(a.SPUS.c, b.SPUS.c);
  const s = a.SPUS;
  assert.ok(s.c.every((c, i) => s.h[i] >= Math.max(c, s.o[i]) && s.l[i] <= Math.min(c, s.o[i]) && s.l[i] > 0));
});
