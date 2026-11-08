import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runBacktest, defaultsOf } from "../trading/lib/engine.js";
import { MORE_STRATEGIES, volTarget, coreDips, weeklyReversal, breakout } from "../trading/lib/strategies2.js";
import { FAMILIES } from "../trading/lib/catalog.js";

const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));
const etfs = ["SPUS", "HLAL", "UMMA", "SPTE", "SPWO", "SPRE"];
const coins = ["BTC-USD", "ETH-USD", "SOL-USD"];
const series = Object.fromEntries([...etfs, ...coins, "SPSK"].map((s) => [s, load(s)]));
const run = (strategy, symbols, params = {}) => runBacktest({ series, symbols, strategy, params, startDate: "2021-11-05", slippageBps: 5, benchmark: symbols[0] });

test("all ten new strategies run, trade, stay cash-only and are deterministic", () => {
  assert.equal(MORE_STRATEGIES.length, 10);
  assert.equal(new Set(MORE_STRATEGIES.map((s) => s.id)).size, 10);
  for (const st of MORE_STRATEGIES) {
    for (const syms of [etfs, coins]) {
      const a = run(st, syms);
      const b = run(st, syms);
      assert.deepEqual(a.equity, b.equity, st.id);
      assert.ok(a.trades.length > 0, `${st.id} traded`);
      assert.ok(a.exposure.every((x) => x <= 1 + 1e-9), `${st.id} never borrowed`);
      assert.ok(a.equity.every((v) => v > 0), `${st.id} equity positive`);
    }
    assert.ok(st.idea && st.rules.length && st.fields.length, `${st.id} documented`);
  }
});

test("every catalog family has a start point inside its search space", () => {
  assert.equal(FAMILIES.length, 14);
  for (const F of FAMILIES) {
    for (const [k, vals] of Object.entries(F.space)) {
      assert.ok(Array.isArray(vals) && vals.length, `${F.id}.${k}`);
      assert.ok(vals.includes(F.start[k]) || F.start[k] === undefined || vals.length === 1, `${F.id}.${k} start ${F.start[k]} in space`);
    }
  }
});

test("Volatility Target holds less when markets are wilder", () => {
  const calm = run(volTarget, ["SPUS"], { targetVol: 15 });
  const avgExposure = calm.exposure.reduce((a, b) => a + b, 0) / calm.exposure.length;
  const btc = run(volTarget, ["BTC-USD"], { targetVol: 15 });
  const btcExposure = btc.exposure.reduce((a, b) => a + b, 0) / btc.exposure.length;
  assert.ok(btcExposure < avgExposure, "Bitcoin is wilder than SPUS, so it gets a smaller position");
  assert.ok(btcExposure < 0.5);
});

test("Core + Dips only sells the core on the trend rule, and dips use the rest", () => {
  const r = run(coreDips, etfs, { coreWeight: 60 });
  const coreSells = r.trades.filter((t) => t.sym === "SPUS");
  assert.ok(coreSells.every((t) => t.exitReason === "core: below trend"));
  const dipTrades = r.trades.filter((t) => t.sym !== "SPUS");
  assert.ok(dipTrades.length > 10);
  assert.ok(dipTrades.every((t) => ["bounce", "time limit", "stop", "stop (gap)"].includes(t.exitReason)));
});

test("Weekly Reversal only rebalances at the end of a week", () => {
  const r = run(weeklyReversal, etfs);
  const mondayOf = (d) => { const t = Date.parse(d + "T00:00:00Z"); return t - ((new Date(t).getUTCDay() || 7) - 1) * 864e5; };
  // Entries happen at the first open of a new week.
  const cal = series.SPUS.d;
  for (const t of r.trades.slice(0, 40)) {
    const i = cal.indexOf(t.entryDate);
    assert.ok(i > 0 && mondayOf(cal[i - 1]) !== mondayOf(cal[i]), `${t.sym} ${t.entryDate}`);
  }
});

test("Breakout buys only after a close above the previous high", () => {
  const p = defaultsOf(breakout);
  const r = run(breakout, etfs);
  for (const t of r.trades.slice(0, 30)) {
    const s = series[t.sym];
    const i = s.d.indexOf(t.entryDate) - 1;
    const prevHigh = Math.max(...s.h.slice(i - p.entryLen, i));
    assert.ok(s.c[i] > prevHigh, `${t.sym} ${t.entryDate}`);
  }
});
