import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureRows, fitLogistic, walkForward, dailyReturns, evaluateWeeks, calibration } from "../trading/lib/daytrade.js";

const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));
const series = Object.fromEntries(["SPUS", "HLAL", "AAPL", "MSFT"].map((s) => [s, load(s)]));

test("features for a day only use that day's open and earlier prices", () => {
  const s = series.AAPL;
  const i = 600;
  const a = featureRows(s)[i];
  // Change everything from day i onward except the open: features must not move.
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

test("walk-forward predictions never train on the day they predict", () => {
  const wf = walkForward(series, ["SPUS", "HLAL", "AAPL", "MSFT"], { start: "2024-01-02", end: "2024-06-28" });
  assert.ok(wf.days.length > 100);
  for (const m of wf.models) assert.ok(m.n > 200);
  // Changing a future day's outcome must not change an earlier prediction.
  const tweaked = { ...series, AAPL: { ...series.AAPL, c: [...series.AAPL.c] } };
  const j = tweaked.AAPL.d.indexOf("2024-06-03");
  tweaked.AAPL.c[j] *= 1.3;
  const wf2 = walkForward(tweaked, ["SPUS", "HLAL", "AAPL", "MSFT"], { start: "2024-01-02", end: "2024-06-28" });
  const before = (w) => w.days.filter((d) => d.date < "2024-06-01").flatMap((d) => d.all.map((x) => x.p));
  assert.deepEqual(before(wf), before(wf2));
});

test("weekly evaluation is reproducible and well-formed", () => {
  const syms = ["SPUS", "HLAL", "AAPL", "MSFT"];
  const wf = walkForward(series, syms, { start: "2023-01-03" });
  const daily = dailyReturns(wf, { threshold: 0.55, maxPositions: 2 });
  const a = evaluateWeeks(series, syms, daily, { weeks: 20, seed: 3, maxPositions: 2 });
  const b = evaluateWeeks(series, syms, daily, { weeks: 20, seed: 3, maxPositions: 2 });
  assert.deepEqual(a.summary, b.summary);
  assert.equal(a.rows.length, 20);
  assert.ok(a.rows.every((r, i) => i === 0 || r.week > a.rows[i - 1].week));
  assert.ok(a.summary.meanCI[0] <= a.summary.meanWeekly && a.summary.meanWeekly <= a.summary.meanCI[1]);
  // No position is ever larger than the account: a day's return can't go below -100%.
  assert.ok(daily.every((d) => d.r > -1));
  const cal = calibration(wf);
  assert.equal(cal.reduce((x, c) => x + c.n, 0), wf.days.reduce((x, d) => x + d.all.length, 0));
});
