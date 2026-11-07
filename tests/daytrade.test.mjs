import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureRows, fitLogistic, walkForward, evaluate, calibration, tradeOutcome, DEFAULTS } from "../trading/lib/daytrade.js";
import { sma } from "../trading/lib/indicators.js";
import { dipBuyer } from "../trading/lib/strategies.js";

const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));
const series = Object.fromEntries(["SPUS", "HLAL", "AAPL", "MSFT"].map((s) => [s, load(s)]));
const syms = ["SPUS", "HLAL", "AAPL", "MSFT"];

test("features for a day only use that day's open and earlier prices", () => {
  const s = series.AAPL;
  const i = 600;
  const a = featureRows(s)[i];
  const t = { ...s, c: [...s.c], h: [...s.h], l: [...s.l] };
  for (let k = i; k < t.c.length; k++) { t.c[k] *= 1.5; t.h[k] *= 1.5; t.l[k] *= 0.5; }
  const b = featureRows(t)[i];
  for (const k of ["gap", "ret1", "ret5", "rsi2", "dist20", "vol20", "range1", "trend"]) assert.equal(a[k], b[k], k);
});

test("logistic regression learns a clear signal", () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 800; i++) {
    const x = Math.sin(i * 12.9898) * 2;
    X.push([x, Math.cos(i)]);
    y.push(x > 0 ? 1 : 0);
  }
  const m = fitLogistic(X, y);
  assert.ok(m.predict([1.5, 0]) > 0.9 && m.predict([-1.5, 0]) < 0.1);
});

const mk = (rows) => ({ d: rows.map((_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`), o: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]) });
const o0 = { maxHold: 3, stopPct: 0.1, costBps: 0 };

test("trade outcomes follow the exit rules", () => {
  // Bounce: closes above its 2-day average on day 1, sells at day 2's open.
  let s = mk([[10, 10, 10, 10], [10, 10, 10, 10], [10, 11, 10, 11], [12, 12, 12, 12]]);
  let r = tradeOutcome(s, 1, sma(s.c, 2), o0);
  assert.equal(r.why, "bounce");
  assert.equal(r.exit, 3);
  assert.ok(Math.abs(r.ret - 0.2) < 1e-12);
  // Stop: falls through 10% below the entry on the entry day.
  s = mk([[10, 10, 10, 10], [10, 10, 8.5, 9], [9, 9, 9, 9]]);
  r = tradeOutcome(s, 1, sma(s.c, 2), o0);
  assert.equal(r.why, "stop");
  assert.ok(Math.abs(r.ret + 0.1) < 1e-12);
  // Time limit after 3 days with no bounce.
  s = mk([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 9.5, 9.5], [9.5, 9.5, 9.4, 9.4], [9.4, 9.4, 9.3, 9.3], [9.3, 9.3, 9.3, 9.3]]);
  r = tradeOutcome(s, 1, sma(s.c, 2), o0);
  assert.equal(r.why, "time limit");
  assert.equal(r.exit, 4);
  // Unfinished at the end of the data.
  assert.equal(tradeOutcome(mk([[10, 10, 10, 10], [10, 10, 10, 10]]), 1, [null, null], o0), null);
});

test("walk-forward never learns from trades that hadn't finished", () => {
  const wf = walkForward(series, syms, { start: "2024-01-02", end: "2024-06-28" });
  assert.ok(wf.dates.length > 100);
  // Rewriting prices from June on must not change any May prediction.
  const tweaked = { ...series };
  for (const s of syms) {
    const t = { ...series[s], c: [...series[s].c], h: [...series[s].h], l: [...series[s].l], o: [...series[s].o] };
    for (let i = t.d.indexOf("2024-06-03"); i < t.d.length; i++) { t.c[i] *= 0.7; t.l[i] *= 0.6; t.o[i] *= 0.7; }
    tweaked[s] = t;
  }
  const wf2 = walkForward(tweaked, syms, { start: "2024-01-02", end: "2024-06-28" });
  const may = (w) => w.samples.filter((x) => x.date < "2024-06-01").map((x) => x.p);
  assert.deepEqual(may(wf), may(wf2));
});

test("the simulated trades match the outcomes the model was trained on", () => {
  const wf = walkForward(series, syms, { start: "2023-01-03" });
  const ev = evaluate(series, syms, wf, { threshold: 0.65, maxPositions: 10, weeks: 30, seed: 3, dipBuyer });
  assert.ok(ev.model.trades.length > 20);
  for (const t of ev.model.trades.slice(0, 50)) {
    const s = series[t.sym];
    const i = s.d.indexOf(t.entryDate);
    const out = tradeOutcome(s, i, sma(s.c, DEFAULTS.exitLen), { ...DEFAULTS });
    assert.equal(s.d[out.exit], t.exitDate, `${t.sym} ${t.entryDate}`);
    assert.ok(Math.abs(out.ret - t.ret) < 1e-9, `${t.sym} ${t.entryDate}`);
  }
});

test("evaluation is reproducible, cash-only and well-formed", () => {
  const wf = walkForward(series, syms, { start: "2023-01-03" });
  const a = evaluate(series, syms, wf, { threshold: 0.7, weeks: 20, seed: 3 });
  const b = evaluate(series, syms, wf, { threshold: 0.7, weeks: 20, seed: 3 });
  assert.deepEqual(a.summary, b.summary);
  assert.equal(a.rows.length, 20);
  assert.ok(a.rows.every((r, i) => i === 0 || r.week > a.rows[i - 1].week));
  assert.ok(a.summary.meanCI[0] <= a.summary.meanWeekly && a.summary.meanWeekly <= a.summary.meanCI[1]);
  assert.ok(a.model.exposure.every((x) => x <= 1 + 1e-9));
  const cal = calibration(wf);
  assert.ok(cal.length >= 3 && cal.every((c) => c.actual >= 0 && c.actual <= 1));
});
