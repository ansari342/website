// Probability trader. Each morning, estimate for every stock the chance that
// a trade bought at today's open ends with a profit after costs, under the
// same exits as Dip Buyer: sell at the next open after the close rises above
// its short average, after a maximum number of days, or at a protective stop.
// Buy only when that chance clears a high bar (75% by default), holding up to
// 10 stocks at once. Long only, cash only: no shorting, no borrowing.
//
// The model is a logistic regression refit every month on the previous two
// years. A past trade only becomes a training example once it has finished,
// so the model never learns from outcomes that were still unknown that day.

import { mulberry32, wilson, summarize, drawdowns } from "./stats.js";
import { runBacktest } from "./engine.js";
import { sma } from "./indicators.js";

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

export const DEFAULTS = { threshold: 0.75, maxPositions: 10, maxHold: 10, stopPct: 0.1, exitLen: 5, costBps: 5 };

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


// What happens to a trade bought at day i's open, using the exit rules.
// Returns null if the trade hadn't finished by the end of the data.
export function tradeOutcome(s, i, exitAvg, { maxHold, stopPct, costBps }) {
  const slip = costBps / 10000;
  const entry = s.o[i] * (1 + slip);
  const stop = entry * (1 - stopPct);
  // Dividends are paid on ex-dates after the entry day while still holding at
  // the close (a stop or an exit at the open comes before that day's dividend).
  let divs = 0;
  const done = (px, exit, why) => ({ ret: (px * (1 - slip) + divs) / entry - 1, exit, why });
  for (let k = i; k < s.c.length; k++) {
    if (k > i && s.o[k] <= stop) return done(s.o[k], k, "stop (gap)");
    if (s.l[k] <= stop) return done(Math.min(stop, s.o[k]), k, "stop");
    if (k > i && s.div && s.div[s.d[k]]) divs += s.div[s.d[k]];
    const bounce = exitAvg[k] != null && s.c[k] > exitAvg[k];
    if (bounce || k - i + 1 >= maxHold) {
      if (k + 1 >= s.c.length) return null;
      return done(s.o[k + 1], k + 1, bounce ? "bounce" : "time limit");
    }
  }
  return null;
}

// Walk-forward probabilities for every symbol and day from `start` on.
export function walkForward(series, symbols, opts = {}) {
  const o = { ...DEFAULTS, trainDays: 504, ...opts };
  const { start, end = null } = o;
  const keys = FEATURES.map((f) => f.key);
  const vec = (r) => keys.map((k) => r[k]);
  const rows = {};
  const outcomes = {};
  const idx = {};
  for (const s of symbols) {
    const ser = series[s];
    rows[s] = featureRows(ser);
    const avg = sma(ser.c, o.exitLen);
    outcomes[s] = ser.c.map((_, i) => (rows[s][i] ? tradeOutcome(ser, i, avg, o) : null));
    idx[s] = new Map(ser.d.map((d, i) => [d, i]));
  }
  const dateSet = new Set();
  for (const s of symbols) for (const d of series[s].d) if (d >= start && (!end || d <= end)) dateSet.add(d);
  const dates = [...dateSet].sort();

  let model = null;
  let lastFit = null;
  const models = [];
  const probs = new Map(); // date -> Map(sym -> p)
  const samples = []; // every stock-day: {date, sym, p, outcome}
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (month !== lastFit) {
      const fromT = Date.parse(date) - o.trainDays * 1.45 * 864e5;
      const X = [];
      const y = [];
      for (const s of symbols) {
        const ser = series[s];
        for (let i = 0; i < ser.d.length && ser.d[i] < date; i++) {
          const r = rows[s][i];
          const out = outcomes[s][i];
          // Only trades that had already finished before today.
          if (!r || !out || ser.d[out.exit] >= date || Date.parse(ser.d[i]) < fromT) continue;
          X.push(vec(r));
          y.push(out.ret > 0 ? 1 : 0);
        }
      }
      if (X.length > 200) {
        model = fitLogistic(X, y, { lambda: 5 });
        models.push({ from: date, n: X.length, weights: model.weights, base: y.reduce((a, b) => a + b, 0) / y.length });
      }
      lastFit = month;
    }
    if (!model) continue;
    const m = new Map();
    for (const s of symbols) {
      const i = idx[s].get(date);
      if (i === undefined || !rows[s][i]) continue;
      const p = model.predict(vec(rows[s][i]));
      m.set(s, p);
      samples.push({ date, sym: s, p, outcome: outcomes[s][i] });
    }
    if (m.size) probs.set(date, m);
  }
  return { probs, samples, models, dates: [...probs.keys()], opts: o };
}

// Engine strategy: buy at the open when p >= threshold; Dip Buyer exits.
function exitRules(o) {
  return {
    prepare: (s) => ({ exit: sma(s.c, o.exitLen) }),
    onClose(ctx) {
      const orders = [];
      for (const [s] of ctx.positions) {
        const i = ctx.bar(s);
        if (i < 0) continue;
        const avg = ctx.ind[s].exit[i];
        if (avg != null && ctx.series[s].c[i] > avg) orders.push({ side: "sell", sym: s, reason: "bounce" });
        else if (ctx.daysHeld(s) >= o.maxHold - 1) orders.push({ side: "sell", sym: s, reason: "time limit" });
      }
      return orders;
    },
  };
}

export function probabilityStrategy(wf, opts = {}) {
  const o = { ...wf.opts, ...opts };
  return {
    id: "prob",
    name: "Probability trader",
    fields: [],
    ...exitRules(o),
    onOpen(ctx) {
      const m = wf.probs.get(ctx.date);
      if (!m) return [];
      const slots = o.maxPositions - ctx.positions.size;
      if (slots <= 0) return [];
      return [...m.entries()]
        .filter(([s, p]) => p >= o.threshold && !ctx.held(s) && ctx.bar(s) >= 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, slots)
        .map(([s, p]) => ({ side: "buy", sym: s, weight: 1 / o.maxPositions, stopPct: o.stopPct, reason: `${Math.round(p * 100)}% chance` }));
    },
  };
}

// Baseline: same exits and position sizes, but entries picked at random at the
// same overall rate as the model's.
export function randomStrategy(wf, rate, opts = {}, seed = 99) {
  const o = { ...wf.opts, ...opts };
  const rand = mulberry32(seed);
  return {
    id: "random",
    name: "Random entries",
    fields: [],
    ...exitRules(o),
    onOpen(ctx) {
      const m = wf.probs.get(ctx.date);
      if (!m) return [];
      const slots = o.maxPositions - ctx.positions.size;
      const picks = [...m.keys()].filter((s) => !ctx.held(s) && ctx.bar(s) >= 0 && rand() < rate);
      return picks.slice(0, Math.max(0, slots)).map((s) => ({ side: "buy", sym: s, weight: 1 / o.maxPositions, stopPct: o.stopPct, reason: "random" }));
    },
  };
}

const weekKey = (date) => {
  const t = Date.parse(date + "T00:00:00Z");
  const wd = new Date(t).getUTCDay() || 7;
  return new Date(t - (wd - 1) * 864e5).toISOString().slice(0, 10);
};

// Weekly returns of an equity curve: change from the previous week's last close.
function weeklyReturns(dates, equity) {
  const out = new Map();
  let prevEnd = null;
  let cur = null;
  dates.forEach((d, i) => {
    const k = weekKey(d);
    if (cur !== k) {
      if (cur !== null) prevEnd = equity[i - 1];
      cur = k;
    }
    if (prevEnd !== null) out.set(k, { ret: equity[i] / prevEnd - 1, days: (out.get(k)?.days || 0) + 1 });
  });
  return out;
}

// Full evaluation: run the model, random entries, Dip Buyer and buy-and-hold
// over the whole period, then score a random sample of weeks.
export function evaluate(series, symbols, wf, { threshold = 0.75, maxPositions = 10, weeks = 52, seed = 7, capital = 10000, benchmark = "SPUS", dipBuyer = null } = {}) {
  const o = { ...wf.opts, threshold, maxPositions };
  const start = wf.dates[0];
  const run = (strategy) => runBacktest({ series, symbols, strategy, capital, slippageBps: o.costBps, startDate: start, benchmark });
  const model = run(probabilityStrategy(wf, o));
  // Match the random baseline's entry rate to the model's.
  const stockDays = wf.samples.length || 1;
  const rate = Math.max(model.trades.length / stockDays, 0.002);
  const random = run(randomStrategy(wf, rate, o, seed + 1000));
  const dip = dipBuyer ? run({ ...dipBuyer, fields: dipBuyer.fields }) : null;

  const wM = weeklyReturns(model.dates, model.equity);
  const wR = weeklyReturns(random.dates, random.equity);
  const wH = weeklyReturns(model.dates, model.benchmark);
  const wD = dip ? weeklyReturns(dip.dates, dip.equity) : null;
  const all = [...wM.keys()].filter((k) => wM.get(k).days >= 3);
  const rand = mulberry32(seed);
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, Math.min(weeks, pool.length)).sort();
  const tradesIn = (k) => model.trades.filter((t) => weekKey(t.entryDate) === k);
  const rows = chosen.map((k) => {
    const t = tradesIn(k);
    return {
      week: k,
      ret: wM.get(k).ret,
      pnl: wM.get(k).ret * capital,
      random: wR.get(k)?.ret ?? 0,
      dip: wD?.get(k)?.ret ?? null,
      hold: wH.get(k)?.ret ?? null,
      opened: t.length,
      won: t.filter((x) => x.pnl > 0).length,
    };
  });
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(a.length - 1, 1));
  };
  const rets = rows.map((r) => r.ret);
  const se = sd(rets) / Math.sqrt(rets.length || 1);
  const trades = model.trades;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const stats = summarize(model);
  return {
    rows,
    model,
    random,
    dip,
    summary: {
      weeks: rows.length,
      upWeeks: rows.filter((r) => r.ret > 0).length,
      flatWeeks: rows.filter((r) => Math.abs(r.ret) < 1e-12).length,
      meanWeekly: mean(rets),
      meanCI: [mean(rets) - 1.96 * se, mean(rets) + 1.96 * se],
      meanRandom: mean(rows.map((r) => r.random)),
      meanDip: wD ? mean(rows.filter((r) => r.dip != null).map((r) => r.dip)) : null,
      meanHold: mean(rows.filter((r) => r.hold != null).map((r) => r.hold)),
      beatRandom: rows.filter((r) => r.ret > r.random).length / (rows.length || 1),
      bestWeek: Math.max(...rets),
      worstWeek: Math.min(...rets),
      trades: trades.length,
      winRate: trades.length ? wins / trades.length : 0,
      winCI: wilson(wins, trades.length),
      avgTrade: trades.length ? mean(trades.map((t) => t.ret)) : 0,
      avgDays: trades.length ? mean(trades.map((t) => t.days)) : 0,
      cagr: stats.cagr,
      maxDrawdown: stats.maxDrawdown,
      exposure: stats.exposure,
      randomCagr: summarize(random).cagr,
      dipCagr: dip ? summarize(dip).cagr : null,
      holdCagr: Math.pow(model.benchmark.at(-1) / capital, 1 / stats.years) - 1,
      holdDrawdown: Math.min(...drawdowns(model.benchmark)),
      years: stats.years,
    },
  };
}

// Calibration over every stock-day: when the model said x%, how often would a
// trade bought that morning actually have made money?
export function calibration(wf, buckets = [0, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 1]) {
  const out = buckets.slice(0, -1).map((lo, i) => ({ lo, hi: buckets[i + 1], n: 0, hits: 0, pSum: 0, retSum: 0 }));
  for (const x of wf.samples) {
    if (!x.outcome) continue;
    const b = out.find((q) => x.p >= q.lo && x.p < q.hi);
    if (!b) continue;
    b.n++;
    b.pSum += x.p;
    b.hits += x.outcome.ret > 0 ? 1 : 0;
    b.retSum += x.outcome.ret;
  }
  return out.filter((b) => b.n).map((b) => ({ ...b, predicted: b.pSum / b.n, actual: b.hits / b.n, avgNet: b.retSum / b.n }));
}
