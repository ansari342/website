// Probability day trading: each morning, estimate the chance that each stock
// closes above its open. Buy at the open only when that chance is high enough,
// sell at the close the same day. Never hold overnight, never short (a likely
// down day just means staying in cash).
//
// The model is a logistic regression refit every month on the previous two
// years only (walk-forward), so every prediction uses only information that
// was available before that day's open.

import { mulberry32, wilson } from "./stats.js";

export const FEATURES = [
  { key: "gap", label: "Opening gap vs yesterday's close" },
  { key: "ret1", label: "Yesterday's return" },
  { key: "ret5", label: "Last 5 days' return" },
  { key: "rsi2", label: "2-day RSI (oversold → overbought)" },
  { key: "dist20", label: "Distance from 20-day average" },
  { key: "vol20", label: "Recent volatility" },
  { key: "range1", label: "Yesterday's high-low range" },
  { key: "trend", label: "Above 200-day average" },
  { key: "mon", label: "Monday" },
  { key: "fri", label: "Friday" },
];

// Feature rows for one series. Row i describes day i using only data known at
// day i's open: earlier closes, plus today's opening price.
export function featureRows(s) {
  const n = s.c.length;
  const rows = new Array(n).fill(null);
  let gain = 0;
  let loss = 0;
  const rsi = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const d = s.c[i] - s.c[i - 1];
    gain = (gain * 1 + Math.max(d, 0)) / 2;
    loss = (loss * 1 + Math.max(-d, 0)) / 2;
    if (i >= 3) rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  for (let i = 201; i < n; i++) {
    const p = i - 1; // yesterday
    let sum20 = 0;
    let sum200 = 0;
    let sq = 0;
    for (let k = 0; k < 20; k++) sum20 += s.c[p - k];
    for (let k = 0; k < 200; k++) sum200 += s.c[p - k];
    for (let k = 0; k < 20; k++) {
      const r = s.c[p - k] / s.c[p - k - 1] - 1;
      sq += r * r;
    }
    const wd = new Date(s.d[i] + "T00:00:00Z").getUTCDay();
    rows[i] = {
      gap: s.o[i] / s.c[p] - 1,
      ret1: s.c[p] / s.c[p - 1] - 1,
      ret5: s.c[p] / s.c[p - 5] - 1,
      rsi2: (rsi[p] ?? 50) / 100 - 0.5,
      dist20: s.c[p] / (sum20 / 20) - 1,
      vol20: Math.sqrt(sq / 20),
      range1: (s.h[p] - s.l[p]) / s.c[p],
      trend: s.c[p] > sum200 / 200 ? 1 : 0,
      mon: wd === 1 ? 1 : 0,
      fri: wd === 5 ? 1 : 0,
      // Outcome (only used for training on past days and for scoring).
      intraday: s.c[i] / s.o[i] - 1,
    };
  }
  return rows;
}

// Ridge-regularized logistic regression fit by Newton's method (IRLS).
export function fitLogistic(X, y, { lambda = 1, iters = 8 } = {}) {
  const k = X[0].length;
  // Standardize features so the penalty treats them evenly.
  const mean = new Array(k).fill(0);
  const sd = new Array(k).fill(0);
  for (const x of X) for (let j = 0; j < k; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < k; j++) sd[j] += (x[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => [1, ...x.map((v, j) => (v - mean[j]) / sd[j])]);
  const m = k + 1;
  let w = new Array(m).fill(0);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: m }, () => new Array(m).fill(0));
    const g = new Array(m).fill(0);
    for (let r = 0; r < Z.length; r++) {
      const z = Z[r];
      let t = 0;
      for (let j = 0; j < m; j++) t += w[j] * z[j];
      const p = 1 / (1 + Math.exp(-t));
      const e = y[r] - p;
      const v = p * (1 - p);
      for (let a = 0; a < m; a++) {
        g[a] += e * z[a];
        const va = v * z[a];
        for (let b = a; b < m; b++) H[a][b] += va * z[b];
      }
    }
    for (let a = 1; a < m; a++) {
      g[a] -= lambda * w[a];
      H[a][a] += lambda;
    }
    for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    const step = solve(H, g);
    if (!step) break;
    w = w.map((v, j) => v + step[j]);
  }
  return {
    predict(x) {
      let t = w[0];
      for (let j = 0; j < k; j++) t += w[j + 1] * ((x[j] - mean[j]) / sd[j]);
      return 1 / (1 + Math.exp(-t));
    },
    weights: w.slice(1),
    bias: w[0],
  };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Walk-forward predictions for every symbol and day from `start` on.
// Returns { days: [{date, picks:[{sym, p, intraday}], all:[...]}], models }
export function walkForward(series, symbols, { start, end = null, trainDays = 504, costBps = 5, refitEvery = "month" } = {}) {
  const cost = (2 * costBps) / 10000; // buy and sell
  const rows = {};
  const idx = {};
  for (const s of symbols) {
    rows[s] = featureRows(series[s]);
    idx[s] = new Map(series[s].d.map((d, i) => [d, i]));
  }
  const dateSet = new Set();
  for (const s of symbols) for (const d of series[s].d) if (d >= start && (!end || d <= end)) dateSet.add(d);
  const dates = [...dateSet].sort();
  const keys = FEATURES.map((f) => f.key);
  const vec = (r) => keys.map((k) => r[k]);

  let model = null;
  let lastFit = null;
  const models = [];
  const days = [];
  for (const date of dates) {
    const period = refitEvery === "month" ? date.slice(0, 7) : date;
    if (period !== lastFit) {
      // Train on the previous `trainDays` calendar-trading days, strictly before today.
      const fromT = Date.parse(date) - trainDays * 1.45 * 864e5;
      const X = [];
      const y = [];
      for (const s of symbols) {
        const ser = series[s];
        for (let i = 0; i < ser.d.length && ser.d[i] < date; i++) {
          const r = rows[s][i];
          if (!r || Date.parse(ser.d[i]) < fromT) continue;
          X.push(vec(r));
          y.push(r.intraday > cost ? 1 : 0); // "worth trading": up by more than costs
        }
      }
      if (X.length > 200) {
        model = fitLogistic(X, y, { lambda: 5 });
        models.push({ from: date, n: X.length, weights: model.weights, base: y.reduce((a, b) => a + b, 0) / y.length });
      }
      lastFit = period;
    }
    if (!model) continue;
    const all = [];
    for (const s of symbols) {
      const i = idx[s].get(date);
      if (i === undefined) continue;
      const r = rows[s][i];
      if (!r) continue;
      all.push({ sym: s, p: model.predict(vec(r)), intraday: r.intraday });
    }
    if (all.length) days.push({ date, all });
  }
  return { days, models, cost };
}

// Daily strategy return: equal-weight the top `maxPositions` stocks whose
// probability clears `threshold`; cash otherwise.
export function dailyReturns(wf, { threshold = 0.55, maxPositions = 3 } = {}) {
  return wf.days.map((d) => {
    const picks = d.all.filter((x) => x.p >= threshold).sort((a, b) => b.p - a.p).slice(0, maxPositions);
    const r = picks.length ? picks.reduce((a, x) => a + (x.intraday - wf.cost), 0) / maxPositions : 0;
    // Baseline: day-trade every stock, every day, with no model.
    const every = d.all.reduce((a, x) => a + (x.intraday - wf.cost), 0) / d.all.length;
    return { date: d.date, r, trades: picks.map((x) => ({ ...x, net: x.intraday - wf.cost })), every };
  });
}

const weekKey = (date) => {
  const t = Date.parse(date + "T00:00:00Z");
  const wd = new Date(t).getUTCDay() || 7;
  return new Date(t - (wd - 1) * 864e5).toISOString().slice(0, 10); // Monday
};

// Sample `weeks` random weeks and score each one.
export function evaluateWeeks(series, symbols, daily, { weeks = 52, seed = 7, capital = 10000, threshold = 0.55, maxPositions = 3, costBps = 5, benchmark = "SPUS" } = {}) {
  const byWeek = new Map();
  for (const d of daily) {
    const k = weekKey(d.date);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(d);
  }
  const all = [...byWeek.keys()].filter((k) => byWeek.get(k).length >= 3).sort();
  const rand = mulberry32(seed);
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, Math.min(weeks, pool.length)).sort();
  const cost = (2 * costBps) / 10000;
  const bench = series[benchmark];
  const bIdx = bench ? new Map(bench.d.map((d, i) => [d, i])) : null;
  const coin = mulberry32(seed + 99);

  const rows = chosen.map((wk) => {
    const ds = byWeek.get(wk);
    let eq = 1;
    let eqEvery = 1;
    let eqCoin = 1;
    const trades = [];
    for (const d of ds) {
      eq *= 1 + d.r;
      eqEvery *= 1 + d.every;
      // Coin-flip baseline: same number of trades as the model, random stocks.
      const n = d.trades.length;
      const pick = [...symbols].sort(() => coin() - 0.5).slice(0, n);
      const coinR = n ? pick.reduce((a, s) => {
        const i = series[s].d.indexOf(d.date);
        return a + (i >= 0 ? series[s].c[i] / series[s].o[i] - 1 - cost : 0);
      }, 0) / maxPositions : 0;
      eqCoin *= 1 + coinR;
      trades.push(...d.trades.map((t) => ({ ...t, date: d.date })));
    }
    let hold = null;
    if (bIdx) {
      const i0 = bIdx.get(ds[0].date);
      const i1 = bIdx.get(ds.at(-1).date);
      if (i0 !== undefined && i1 !== undefined) hold = bench.c[i1] / bench.o[i0] - 1;
    }
    return {
      week: wk,
      ret: eq - 1,
      pnl: (eq - 1) * capital,
      every: eqEvery - 1,
      coin: eqCoin - 1,
      hold,
      trades: trades.length,
      wins: trades.filter((t) => t.net > 0).length,
    };
  });

  const trades = rows.reduce((a, r) => a + r.trades, 0);
  const wins = rows.reduce((a, r) => a + r.wins, 0);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(a.length - 1, 1));
  };
  const rets = rows.map((r) => r.ret);
  const upWeeks = rows.filter((r) => r.ret > 0).length;
  const flatWeeks = rows.filter((r) => r.trades === 0).length;
  const tradedWeeks = rows.length - flatWeeks;
  return {
    rows,
    summary: {
      weeks: rows.length,
      tradedWeeks,
      upWeeks,
      upRate: tradedWeeks ? upWeeks / tradedWeeks : 0,
      upCI: wilson(upWeeks, tradedWeeks),
      meanWeekly: mean(rets),
      // Rough 95% range for the true average weekly return.
      meanCI: [mean(rets) - 1.96 * (sd(rets) / Math.sqrt(rets.length || 1)), mean(rets) + 1.96 * (sd(rets) / Math.sqrt(rets.length || 1))],
      totalPnl: rows.reduce((a, r) => a + r.pnl, 0),
      bestWeek: Math.max(...rets),
      worstWeek: Math.min(...rets),
      trades,
      winRate: trades ? wins / trades : 0,
      winCI: wilson(wins, trades),
      meanEvery: mean(rows.map((r) => r.every)),
      meanCoin: mean(rows.map((r) => r.coin)),
      meanHold: mean(rows.filter((r) => r.hold != null).map((r) => r.hold)),
      beatCoin: rows.filter((r) => r.ret > r.coin).length / (rows.length || 1),
    },
  };
}

// Calibration: when the model said "x% chance of a worthwhile up day", how
// often did it actually happen? Uses every stock-day, not just trades.
export function calibration(wf, buckets = [0, 0.45, 0.5, 0.55, 0.6, 0.65, 1]) {
  const out = buckets.slice(0, -1).map((lo, i) => ({ lo, hi: buckets[i + 1], n: 0, hits: 0, pSum: 0, retSum: 0 }));
  for (const d of wf.days) {
    for (const x of d.all) {
      const b = out.find((o) => x.p >= o.lo && x.p < o.hi);
      if (!b) continue;
      b.n++;
      b.pSum += x.p;
      b.hits += x.intraday > wf.cost ? 1 : 0;
      b.retSum += x.intraday - wf.cost;
    }
  }
  return out.filter((b) => b.n).map((b) => ({ ...b, predicted: b.pSum / b.n, actual: b.hits / b.n, avgNet: b.retSum / b.n }));
}
