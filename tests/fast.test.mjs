import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBars, aggregate, simulate, hold, sma, rollMax, rollMin, rsi, indexAt } from "../trading/lib/fast.js";
import { allStrategies, searchSpace, build, MARKETS } from "../trading/lib/lab100.js";
import { rsi as slowRsi } from "../trading/lib/indicators.js";

const H = 36e5;
const bars = (rows, step = H, t0 = Date.UTC(2024, 0, 1)) => makeBars({ t: rows.map((_, i) => t0 + i * step), o: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]), v: rows.map((r) => r[4] ?? 1) });
const u8 = (n, on = []) => { const a = new Uint8Array(n); on.forEach((i) => (a[i] = 1)); return a; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("indicators match simple definitions", () => {
  const a = Float64Array.from([3, 1, 4, 1, 5, 9, 2, 6]);
  assert.deepEqual(Array.from(sma(a, 3)).slice(2), [8 / 3, 2, 10 / 3, 5, 16 / 3, 17 / 3]);
  assert.deepEqual(Array.from(rollMax(a, 3)).slice(2), [4, 4, 5, 9, 9, 9]);
  assert.deepEqual(Array.from(rollMin(a, 3)).slice(2), [1, 1, 1, 1, 2, 2]);
  const slow = slowRsi(Array.from(a), 3);
  rsi(a, 3).forEach((v, i) => { if (slow[i] != null) near(v, slow[i]); });
});

test("orders fill at the next bar's open, never the signal bar", () => {
  const b = bars([[10, 10, 10, 10], [12, 12, 12, 12], [12, 12, 12, 12], [15, 15, 15, 15], [15, 15, 15, 15]]);
  const r = simulate(b, u8(5, [0]), u8(5, [2]), { cost: 0 });
  near(r.ret, 15 / 12 - 1); // bought at bar 1's open (12), sold at bar 3's open (15)
  assert.equal(r.trades, 1);
});

test("costs are paid on both the buy and the sell", () => {
  const b = bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10]]);
  near(simulate(b, u8(4, [0]), u8(4, [1]), { cost: 0.001 }).ret, 0.999 / 1.001 - 1);
});

test("stops fill at the stop, or at the open if price gaps through; stop beats target", () => {
  let b = bars([[100, 100, 100, 100], [100, 101, 94, 96], [96, 96, 96, 96]]);
  near(simulate(b, u8(3, [0]), u8(3), { cost: 0, stopPct: 0.05 }).ret, -0.05);
  b = bars([[100, 100, 100, 100], [100, 100, 100, 100], [90, 91, 89, 90], [90, 90, 90, 90]]);
  near(simulate(b, u8(4, [0]), u8(4), { cost: 0, stopPct: 0.05 }).ret, -0.1);
  b = bars([[100, 100, 100, 100], [100, 110, 90, 100], [100, 100, 100, 100]]);
  near(simulate(b, u8(3, [0]), u8(3), { cost: 0, stopPct: 0.05, takePct: 0.05 }).ret, -0.05);
});

test("time limit and end-of-day exit", () => {
  const rows = Array.from({ length: 30 }, (_, i) => [100 + i, 100 + i, 100 + i, 100 + i]);
  const b = bars(rows);
  const r = simulate(b, u8(30, [0]), u8(30), { cost: 0, maxHold: 3 });
  near(r.ret, 104 / 101 - 1); // in at bar 1 open (101), held 3 bars, out at bar 4 open (104)
  const e = simulate(b, u8(30, [0]), u8(30), { cost: 0, eod: true });
  near(e.ret, 123 / 101 - 1); // flat at the close of the day's last bar (bar 23)
  assert.equal(e.trades, 1);
});

test("a result never depends on later bars", () => {
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  let p = 100;
  const rows = Array.from({ length: 3000 }, () => { const o = p; p *= 1 + (rnd() - 0.5) * 0.02; const c = p; return [o, Math.max(o, c) * 1.002, Math.min(o, c) * 0.998, c, 1 + rnd() * 5]; });
  const full = bars(rows, 5 * 60e3);
  const cut = bars(rows.slice(0, 2000), 5 * 60e3);
  for (const s of allStrategies().filter((x) => x.market === "c5")) {
    const { start } = searchSpace(s);
    const a = build(s, full, start);
    const c = build(s, cut, start);
    assert.deepEqual(Array.from(a.enter.slice(0, 2000)), Array.from(c.enter), s.key);
    assert.deepEqual(Array.from(a.exit.slice(0, 2000)), Array.from(c.exit), s.key);
  }
});

test("there are exactly 100 strategies, each with a valid search space", () => {
  const all = allStrategies();
  assert.equal(all.length, 100);
  assert.equal(new Set(all.map((s) => s.key)).size, 100);
  for (const s of all) {
    const { space, start } = searchSpace(s);
    assert.ok(MARKETS[s.market]);
    for (const [k, vals] of Object.entries(space)) assert.ok(vals.includes(start[k]), `${s.key}.${k} start ${start[k]}`);
  }
});

test("aggregate, hold and indexAt", () => {
  const b = bars(Array.from({ length: 24 }, (_, i) => [i + 1, i + 2, i + 0.5, i + 1.5, 2]), 5 * 60e3);
  const hr = aggregate(b, H);
  assert.equal(hr.n, 2);
  assert.deepEqual([hr.o[0], hr.h[0], hr.l[0], hr.c[0], hr.v[0]], [1, 13, 0.5, 12.5, 24]);
  assert.equal(indexAt(b, b.t[7]), 7);
  near(hold(b, { cost: 0, from: 1, to: 24 }).ret, 24.5 / 2 - 1);
});
