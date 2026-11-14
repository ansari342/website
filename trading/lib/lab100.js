// The 100-strategy lab: rule families × markets.
//
// 16 general rules run on four markets (5-minute crypto, hourly crypto, hourly
// halal ETFs, daily halal ETFs) = 64. Five within-the-day rules run on the
// three intraday markets = 15. Twenty-one rules use extra data (fear gauges,
// rates, the dollar, credit, breadth, news tone, crypto Fear & Greed, and a
// probability model with and without those inputs) on the daily markets.
// All are long-or-cash: no shorting, no borrowing.

import { memo, sma, ema, rollStd, rollMax, rollMin, rsi, atr, roc, fromState } from "./fast.js";

const U8 = (n) => new Uint8Array(n);
const M = (b, key, f) => memo(b, key, f);
const SMA = (b, n) => M(b, `sma${n}`, () => sma(b.c, n));
const EMA = (b, n) => M(b, `ema${n}`, () => ema(b.c, n));
const STD = (b, n) => M(b, `std${n}`, () => rollStd(b.c, n));
const RSI = (b, n) => M(b, `rsi${n}`, () => rsi(b.c, n));
const ROC = (b, n) => M(b, `roc${n}`, () => roc(b.c, n));
const ATR = (b, n) => M(b, `atr${n}`, () => atr(b, n));
const HI = (b, n) => M(b, `hi${n}`, () => rollMax(b.h, n));
const LO = (b, n) => M(b, `lo${n}`, () => rollMin(b.l, n));
const VSMA = (b, n) => M(b, `vsma${n}`, () => sma(b.v, n));
const XSMA = (b, name, n) => M(b, `x:${name}:${n}`, () => sma(b.x[name], n));

const stateOf = (b, f) => {
  const s = U8(b.n);
  for (let i = 1; i < b.n; i++) s[i] = f(i) ? 1 : 0;
  return fromState(s);
};
const signals = (b, fe, fx) => {
  const enter = U8(b.n);
  const exit = U8(b.n);
  for (let i = 1; i < b.n; i++) {
    if (fe(i)) enter[i] = 1;
    if (fx && fx(i)) exit[i] = 1;
  }
  return { enter, exit };
};

/* ---------- 16 general rules ---------- */
const GENERAL = [
  {
    id: "macross", name: "Moving-average cross", idea: "Hold while the fast average is above the slow average.",
    space: (m) => ({ fast: m.short, slow: m.lens }), start: (m) => ({ fast: m.short[1], slow: m.lens[2] }),
    signal: (b, p) => { const f = SMA(b, p.fast), s = SMA(b, p.slow); return stateOf(b, (i) => f[i] > s[i]); },
  },
  {
    id: "donchian", name: "New-high breakout", idea: "Buy a close above the highest high of the last N bars; sell below the lowest low of a shorter window.",
    space: (m) => ({ entryLen: m.lens, exitLen: m.short }), start: (m) => ({ entryLen: m.lens[2], exitLen: m.short[2] }),
    signal: (b, p) => { const hi = HI(b, p.entryLen), lo = LO(b, p.exitLen); return signals(b, (i) => b.c[i] > hi[i - 1], (i) => b.c[i] < lo[i - 1]); },
  },
  {
    id: "rsirev", name: "RSI bounce", idea: "Buy when RSI is oversold; sell when it recovers.",
    space: () => ({ len: [2, 3, 5, 9, 14], lo: [5, 10, 15, 20, 25, 30], hi: [50, 60, 70, 80] }), start: () => ({ len: 5, lo: 20, hi: 60 }),
    signal: (b, p) => { const r = RSI(b, p.len); return signals(b, (i) => r[i] < p.lo, (i) => r[i] > p.hi); },
  },
  {
    id: "bollrev", name: "Band bounce", idea: "Buy below the lower Bollinger band; sell back at the average.",
    space: (m) => ({ len: m.lens.slice(1, 5), k: [1, 1.5, 2, 2.5, 3] }), start: (m) => ({ len: m.lens[2], k: 2 }),
    signal: (b, p) => { const mid = SMA(b, p.len), sd = STD(b, p.len); return signals(b, (i) => b.c[i] < mid[i] - p.k * sd[i], (i) => b.c[i] >= mid[i]); },
  },
  {
    id: "bollbreak", name: "Band breakout", idea: "Buy a close above the upper Bollinger band; sell back at the average.",
    space: (m) => ({ len: m.lens.slice(1, 5), k: [1, 1.5, 2, 2.5, 3] }), start: (m) => ({ len: m.lens[2], k: 2 }),
    signal: (b, p) => { const mid = SMA(b, p.len), sd = STD(b, p.len); return signals(b, (i) => b.c[i] > mid[i] + p.k * sd[i], (i) => b.c[i] < mid[i]); },
  },
  {
    id: "momburst", name: "Momentum burst", idea: "Buy after a sharp rise over the last few bars; hold a fixed time.", needsHold: true,
    space: () => ({ n: [1, 2, 3, 6, 12], x: [1, 2, 3, 5, 8] }), start: () => ({ n: 3, x: 3 }),
    signal: (b, p, m) => { const r = ROC(b, p.n); return signals(b, (i) => r[i] > p.x * m.u); },
  },
  {
    id: "dipburst", name: "Sharp-drop rebound", idea: "Buy after a sharp fall over the last few bars; hold a fixed time.", needsHold: true,
    space: () => ({ n: [1, 2, 3, 6, 12], x: [1, 2, 3, 5, 8] }), start: () => ({ n: 3, x: 3 }),
    signal: (b, p, m) => { const r = ROC(b, p.n); return signals(b, (i) => r[i] < -p.x * m.u); },
  },
  {
    id: "macd", name: "MACD", idea: "Hold while the MACD line is above its signal line.",
    space: () => ({ fast: [6, 12, 24], slow: [26, 52, 100], sig: [5, 9, 18] }), start: () => ({ fast: 12, slow: 26, sig: 9 }),
    signal: (b, p) => {
      const line = M(b, `macd${p.fast}_${p.slow}`, () => { const f = EMA(b, p.fast), s = EMA(b, p.slow); return Float64Array.from(f, (v, i) => v - s[i]); });
      const sg = M(b, `macds${p.fast}_${p.slow}_${p.sig}`, () => ema(line, p.sig));
      return stateOf(b, (i) => line[i] > sg[i]);
    },
  },
  {
    id: "downstreak", name: "Losing-streak bounce", idea: "Buy after several down bars in a row; sell on the first up bar.",
    space: () => ({ k: [2, 3, 4, 5, 6, 7] }), start: () => ({ k: 3 }),
    signal: (b, p) => {
      const run = M(b, "downrun", () => { const r = new Int32Array(b.n); for (let i = 1; i < b.n; i++) r[i] = b.c[i] < b.c[i - 1] ? r[i - 1] + 1 : 0; return r; });
      return signals(b, (i) => run[i] >= p.k, (i) => b.c[i] > b.c[i - 1]);
    },
  },
  {
    id: "volrev", name: "Panic-volume rebound", idea: "Buy a falling bar on unusually heavy volume (forced selling); hold a fixed time.", needsHold: true,
    space: (m) => ({ len: m.lens.slice(1, 4), mult: [1.5, 2, 3, 4, 6] }), start: (m) => ({ len: m.lens[2], mult: 3 }),
    signal: (b, p) => { const av = VSMA(b, p.len); return signals(b, (i) => b.v[i] > p.mult * av[i - 1] && b.c[i] < b.o[i]); },
  },
  {
    id: "volbreak", name: "Volume breakout", idea: "Buy a strong up bar on unusually heavy volume; sell below a short average.",
    space: (m) => ({ len: m.lens.slice(1, 4), mult: [1.5, 2, 3, 4, 6], exitLen: m.short }), start: (m) => ({ len: m.lens[2], mult: 2, exitLen: m.short[2] }),
    signal: (b, p) => { const av = VSMA(b, p.len), ex = SMA(b, p.exitLen); return signals(b, (i) => b.v[i] > p.mult * av[i - 1] && b.c[i] > b.o[i] && b.c[i] - b.l[i] > 0.75 * (b.h[i] - b.l[i]), (i) => b.c[i] < ex[i]); },
  },
  {
    id: "squeeze", name: "Squeeze breakout", idea: "After an unusually quiet stretch, buy a close above the upper band; sell back at the average.",
    space: (m) => ({ len: m.lens.slice(1, 4), k: [1, 1.5, 2, 2.5], sq: m.lens.slice(2, 5) }), start: (m) => ({ len: m.lens[2], k: 2, sq: m.lens[3] }),
    signal: (b, p) => {
      const mid = SMA(b, p.len), sd = STD(b, p.len);
      const bw = M(b, `bw${p.len}`, () => Float64Array.from(sd, (v, i) => v / mid[i]));
      const mn = M(b, `bwmin${p.len}_${p.sq}`, () => rollMin(bw, p.sq));
      return signals(b, (i) => bw[i - 1] <= 1.15 * mn[i - 1] && b.c[i] > mid[i] + p.k * sd[i], (i) => b.c[i] < mid[i]);
    },
  },
  {
    id: "pullback", name: "Uptrend dip", idea: "In a long-term uptrend, buy a sharp short-term dip; sell on the bounce (Dip Buyer).",
    space: (m) => ({ trend: m.lens.slice(3), lo: [5, 10, 15, 20, 30], exitLen: m.short }), start: (m) => ({ trend: m.lens[m.lens.length - 1], lo: 15, exitLen: m.short[1] }),
    signal: (b, p) => { const t = SMA(b, p.trend), r = RSI(b, 2), ex = SMA(b, p.exitLen); return signals(b, (i) => b.c[i] > t[i] && r[i] < p.lo, (i) => b.c[i] > ex[i]); },
  },
  {
    id: "atrbreak", name: "Volatility-channel breakout", idea: "Buy a close above the average plus a multiple of the typical bar range; sell back at the average.",
    space: (m) => ({ len: m.lens.slice(1, 5), mult: [1, 1.5, 2, 3, 4] }), start: (m) => ({ len: m.lens[2], mult: 2 }),
    signal: (b, p) => { const e = EMA(b, p.len), a = ATR(b, p.len); return signals(b, (i) => b.c[i] > e[i] + p.mult * a[i], (i) => b.c[i] < e[i]); },
  },
  {
    id: "stoch", name: "Stochastic bounce", idea: "Buy when price sits near the bottom of its recent range; sell near the top.",
    space: (m) => ({ len: m.lens.slice(0, 4), lo: [5, 10, 20, 30], hi: [50, 70, 80, 90] }), start: (m) => ({ len: m.lens[1], lo: 20, hi: 80 }),
    signal: (b, p) => {
      const k = M(b, `stoch${p.len}`, () => { const hi = HI(b, p.len), lo = LO(b, p.len); return Float64Array.from(b.c, (c, i) => (100 * (c - lo[i])) / (hi[i] - lo[i] || NaN)); });
      return signals(b, (i) => k[i] < p.lo, (i) => k[i] > p.hi);
    },
  },
  {
    id: "ibs", name: "Weak-close bounce", idea: "Buy when a bar closes near its low; sell when a bar closes near its high.",
    space: () => ({ lo: [5, 10, 15, 20, 30], hi: [50, 60, 70, 80, 90] }), start: () => ({ lo: 15, hi: 70 }),
    signal: (b, p) => {
      const s = M(b, "ibs", () => Float64Array.from(b.c, (c, i) => (100 * (c - b.l[i])) / (b.h[i] - b.l[i] || NaN)));
      return signals(b, (i) => s[i] < p.lo, (i) => s[i] > p.hi);
    },
  },
];

/* ---------- 5 within-the-day rules (always flat by the end of the day) ---------- */
const dayOpen = (b) => M(b, "dayopen", () => { const a = new Float64Array(b.n); for (let i = 0; i < b.n; i++) a[i] = b.first[i] ? b.o[i] : a[i - 1]; return a; });
const prevDayOpen = (b) => M(b, "prevdayopen", () => { const a = new Float64Array(b.n).fill(NaN); let prev = NaN, cur = NaN; for (let i = 0; i < b.n; i++) { if (b.first[i]) { prev = cur; cur = b.o[i]; } a[i] = prev; } return a; });
const INTRADAY = [
  {
    id: "timewindow", name: "Time-of-day window", idea: "Hold only during a fixed window each day, starting at a chosen hour.", needsHold: true,
    space: (m) => ({ hour: m.hours }), start: (m) => ({ hour: m.hours[0] }),
    signal: (b, p) => signals(b, (i) => b.hour[i] === p.hour && b.hour[i - 1] !== p.hour),
  },
  {
    id: "orb", name: "Opening-range breakout", idea: "After the day's first bars set a range, buy a close above its high; sell at the end of the day.", eod: true,
    space: () => ({ bars: [1, 2, 3, 6, 12] }), start: () => ({ bars: 2 }),
    signal: (b, p) => {
      const top = M(b, `orb${p.bars}`, () => { const a = new Float64Array(b.n).fill(NaN); let hi = 0; for (let i = 0; i < b.n; i++) { if (b.first[i]) hi = 0; if (b.inDay[i] < p.bars) { if (b.h[i] > hi) hi = b.h[i]; } else a[i] = hi; } return a; });
      return signals(b, (i) => b.c[i] > top[i] && !(b.c[i - 1] > top[i - 1]));
    },
  },
  {
    id: "firstmove", name: "Early-move follow-through", idea: "If the day's first bars are up by enough, hold for the rest of the day.", eod: true,
    space: () => ({ bars: [1, 2, 3, 6, 12], x: [0, 1, 2, 3, 5] }), start: () => ({ bars: 2, x: 1 }),
    signal: (b, p, m) => { const op = dayOpen(b); return signals(b, (i) => b.inDay[i] === p.bars - 1 && b.c[i] / op[i] - 1 > p.x * m.u); },
  },
  {
    id: "dayfade", name: "Yesterday's-drop rebound", idea: "If today opens well below yesterday's open, buy for the day; sell at the end of the day.", eod: true,
    space: () => ({ x: [1, 2, 3, 5, 8, 12] }), start: () => ({ x: 3 }),
    signal: (b, p, m) => { const prev = prevDayOpen(b); return signals(b, (i) => b.first[i] && b.o[i] / prev[i] - 1 < -p.x * m.u); },
  },
  {
    id: "weekday", name: "Day-of-week", idea: "Hold only on one chosen day of the week.", eod: true,
    space: (m) => ({ dow: m.dows }), start: (m) => ({ dow: m.dows[0] }),
    signal: (b, p) => signals(b, (i) => b.first[i] && b.dow[i] === p.dow),
  },
];

/* ---------- 21 extra-data rules (daily bars; b.x holds the extra series) ---------- */
const X = (b, k) => b.x[k];
const LEN = [10, 20, 50, 100, 200];
const xAbove = (name, flip = false) => (b, p) => { const a = X(b, name), s = XSMA(b, name, p.len); return stateOf(b, (i) => (flip ? a[i] < s[i] : a[i] > s[i])); };
const EXTRA_ETF = [
  { id: "vixspike", name: "Fear-spike buyer", data: "VIX", idea: "Buy when the VIX fear gauge jumps well above its average; sell when it settles back.",
    space: () => ({ len: [10, 20, 50], x: [10, 20, 30, 50, 75] }), start: () => ({ len: 20, x: 30 }),
    signal: (b, p) => { const v = X(b, "vix"), s = XSMA(b, "vix", p.len); return signals(b, (i) => v[i] > s[i] * (1 + p.x / 100), (i) => v[i] < s[i]); } },
  { id: "vixcalm", name: "Calm-market holder", data: "VIX", idea: "Hold only while the VIX fear gauge is below a level.",
    space: () => ({ level: [14, 16, 18, 20, 22, 25, 30, 35] }), start: () => ({ level: 22 }),
    signal: (b, p) => { const v = X(b, "vix"); return stateOf(b, (i) => v[i] < p.level); } },
  { id: "feardips", name: "Fearful dips", data: "VIX", idea: "Buy sharp dips only when the VIX is elevated; sell on the bounce.",
    space: () => ({ lo: [5, 10, 15, 20, 30], level: [14, 16, 18, 20, 25, 30], exitLen: [3, 5, 10] }), start: () => ({ lo: 15, level: 18, exitLen: 5 }),
    signal: (b, p) => { const v = X(b, "vix"), r = RSI(b, 2), ex = SMA(b, p.exitLen); return signals(b, (i) => r[i] < p.lo && v[i] > p.level, (i) => b.c[i] > ex[i]); } },
  { id: "vixterm", name: "Fear term structure", data: "VIX and 3-month VIX", idea: "Hold while near-term fear is below 3-month fear (markets calm about the short term).",
    space: () => ({ r: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1] }), start: () => ({ r: 1 }),
    signal: (b, p) => { const v = X(b, "vix"), w = X(b, "vix3m"); return stateOf(b, (i) => v[i] / w[i] < p.r); } },
  { id: "credit", name: "Credit-stress filter", data: "High-yield bond prices (as a gauge only)", idea: "Hold while high-yield bond prices are above their average (credit markets calm).",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }), signal: xAbove("hyg") },
  { id: "dollar", name: "Weak-dollar filter", data: "US dollar index", idea: "Hold while the dollar is below its average.",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }), signal: xAbove("dxy", true) },
  { id: "rates", name: "Falling-rates filter", data: "10-year Treasury yield (as a gauge only)", idea: "Hold while the 10-year yield is below its average.",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }), signal: xAbove("tnx", true) },
  { id: "breadth", name: "Broad-uptrend filter", data: "Market breadth", idea: "Hold while enough of the halal universe is above its own 50-day average.",
    space: () => ({ x: [20, 30, 40, 50, 60, 70, 80] }), start: () => ({ x: 50 }),
    signal: (b, p) => { const br = X(b, "breadth"); return stateOf(b, (i) => br[i] * 100 > p.x); } },
  { id: "washout", name: "Breadth washout", data: "Market breadth", idea: "Buy when almost nothing is in an uptrend (washed out); sell when breadth recovers.",
    space: () => ({ lo: [10, 20, 30, 40], hi: [50, 60, 70, 80] }), start: () => ({ lo: 20, hi: 60 }),
    signal: (b, p) => { const br = X(b, "breadth"); return signals(b, (i) => br[i] * 100 < p.lo, (i) => br[i] * 100 > p.hi); } },
  { id: "newsfear", name: "Gloomy-news buyer", data: "GDELT news tone", idea: "Buy when the tone of stock-market news is unusually negative; sell when it normalizes.",
    space: () => ({ len: [20, 50, 100], z: [0.5, 1, 1.5, 2, 2.5] }), start: () => ({ len: 50, z: 1.5 }),
    signal: (b, p) => { const t = X(b, "tone"), m = XSMA(b, "tone", p.len), sd = M(b, `x:tonesd:${p.len}`, () => rollStd(t, p.len)); return signals(b, (i) => (t[i] - m[i]) / sd[i] < -p.z, (i) => t[i] > m[i]); } },
  { id: "newsmood", name: "Improving-news holder", data: "GDELT news tone", idea: "Hold while the short-term news tone is above its longer-term average.",
    space: () => ({ fast: [3, 5, 10, 20], slow: [20, 50, 100, 200] }), start: () => ({ fast: 5, slow: 50 }),
    signal: (b, p) => { const f = XSMA(b, "tone", p.fast), s = XSMA(b, "tone", p.slow); return stateOf(b, (i) => f[i] > s[i]); } },
  { id: "goldratio", name: "Stocks-versus-gold", data: "Gold price", idea: "Hold while the fund is outperforming gold (its ratio to gold is above average).",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }),
    signal: (b, p) => { const r = M(b, "x:goldratio", () => Float64Array.from(b.c, (c, i) => c / b.x.gld[i])), s = M(b, `x:goldratio:${p.len}`, () => sma(r, p.len)); return stateOf(b, (i) => r[i] > s[i]); } },
];
const EXTRA_CRYPTO = [
  { id: "fearbuy", name: "Extreme-fear buyer", data: "Crypto Fear & Greed", idea: "Buy when the Fear & Greed index shows fear; sell when it shows greed.",
    space: () => ({ lo: [10, 15, 20, 25, 30, 40], hi: [50, 60, 70, 80] }), start: () => ({ lo: 25, hi: 60 }),
    signal: (b, p) => { const f = X(b, "fng"); return signals(b, (i) => f[i] < p.lo, (i) => f[i] > p.hi); } },
  { id: "greedon", name: "Greed follower", data: "Crypto Fear & Greed", idea: "Hold only while the Fear & Greed index is above a level.",
    space: () => ({ level: [30, 40, 50, 60, 70, 80] }), start: () => ({ level: 50 }),
    signal: (b, p) => { const f = X(b, "fng"); return stateOf(b, (i) => f[i] > p.level); } },
  { id: "fngrise", name: "Improving-mood holder", data: "Crypto Fear & Greed", idea: "Hold while the Fear & Greed index is above its own average.",
    space: () => ({ len: [7, 14, 30, 60, 90] }), start: () => ({ len: 30 }), signal: xAbove("fng") },
  { id: "btclead", name: "Bitcoin-trend filter", data: "Bitcoin price", idea: "Hold a coin only while Bitcoin is above its average.",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }), signal: xAbove("btc") },
  { id: "cdollar", name: "Weak-dollar filter", data: "US dollar index", idea: "Hold while the dollar is below its average.",
    space: () => ({ len: LEN }), start: () => ({ len: 50 }), signal: xAbove("dxy", true) },
];
// Probability model, with and without the extra inputs. b.x.model[key] holds
// walk-forward probabilities prepared by scripts/lab100.mjs.
const model = (alt) => ({
  id: alt ? "mlalt" : "mlprice", name: alt ? "Probability model + extra data" : "Probability model, prices only", data: alt ? "All extra inputs" : "Prices only",
  idea: alt ? "A model retrained monthly on prices plus the extra inputs estimates the chance of a gain over the next few days; buy when it's high enough." : "The same monthly-retrained model using price features only, as the comparison.",
  space: () => ({ h: [1, 3, 5, 10], thr: [0.5, 0.52, 0.55, 0.58, 0.6, 0.65, 0.7] }), start: () => ({ h: 5, thr: 0.55 }), ownHold: true,
  signal: (b, p) => { const pr = b.x.model[`${alt ? "alt" : "price"}${p.h}`]; const s = signals(b, (i) => pr[i] >= p.thr); s.maxHold = p.h; return s; },
});

/* ---------- markets ---------- */
export const MARKETS = {
  c5: { label: "Crypto, 5-minute bars", bar: "5 min", cost: 0.001, u: 0.001, lens: [5, 10, 20, 50, 100, 200, 500], short: [3, 5, 10, 20, 50], hours: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], dows: [0, 1, 2, 3, 4, 5, 6],
    stops: [0, 0.003, 0.005, 0.01, 0.02, 0.03, 0.05], takes: [0, 0.003, 0.005, 0.01, 0.02, 0.04, 0.08], holds: [0, 3, 6, 12, 24, 48, 96, 288], intraday: true },
  c1h: { label: "Crypto, hourly bars", bar: "1 hour", cost: 0.001, u: 0.004, lens: [5, 10, 20, 50, 100, 200, 500], short: [3, 5, 10, 20, 50], hours: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], dows: [0, 1, 2, 3, 4, 5, 6],
    stops: [0, 0.01, 0.02, 0.03, 0.05, 0.08], takes: [0, 0.01, 0.02, 0.04, 0.08, 0.15], holds: [0, 2, 4, 8, 12, 24, 72, 168], intraday: true },
  e1h: { label: "Halal ETFs, hourly bars", bar: "1 hour", cost: 0.0005, u: 0.003, lens: [5, 10, 20, 50, 100, 200, 350], short: [3, 5, 10, 20, 50], hours: [9, 10, 11, 12, 13, 14, 15], dows: [1, 2, 3, 4, 5],
    stops: [0, 0.005, 0.01, 0.02, 0.03, 0.05], takes: [0, 0.005, 0.01, 0.02, 0.04, 0.08], holds: [0, 2, 4, 7, 14, 35, 70], intraday: true },
  ed: { label: "Halal ETFs, daily bars", bar: "1 day", cost: 0.0005, u: 0.01, lens: [5, 10, 20, 50, 100, 200], short: [3, 5, 10, 20, 50], stops: [0, 0.03, 0.05, 0.075, 0.1, 0.15], takes: [0, 0.03, 0.05, 0.1, 0.2], holds: [0, 2, 3, 5, 10, 20, 40] },
  cd: { label: "Crypto, daily bars", bar: "1 day", cost: 0.001, u: 0.03, lens: [5, 10, 20, 50, 100, 200], short: [3, 5, 10, 20, 50], stops: [0, 0.05, 0.1, 0.15, 0.2, 0.3], takes: [0, 0.1, 0.2, 0.4, 0.8], holds: [0, 2, 3, 5, 10, 20, 40] },
};

// The full list of 100: { key, market, rule }.
export function allStrategies() {
  const out = [];
  for (const mk of ["c5", "c1h", "e1h", "ed"]) for (const r of GENERAL) out.push({ key: `${mk}:${r.id}`, market: mk, rule: r, group: "General rule" });
  for (const mk of ["c5", "c1h", "e1h"]) for (const r of INTRADAY) out.push({ key: `${mk}:${r.id}`, market: mk, rule: r, group: "Within the day" });
  for (const r of [...EXTRA_ETF, model(false), model(true)]) out.push({ key: `ed:${r.id}`, market: "ed", rule: r, group: "Extra data" });
  for (const r of [...EXTRA_CRYPTO, model(false), model(true)]) out.push({ key: `cd:${r.id}`, market: "cd", rule: r, group: "Extra data" });
  return out;
}

// Search space and starting point for one strategy: the rule's own settings
// plus the shared exits (stop, profit target, time limit).
export function searchSpace(s) {
  const m = MARKETS[s.market];
  const r = s.rule;
  const space = { ...r.space(m), stop: m.stops, take: m.takes };
  const start = { ...r.start(m), stop: 0, take: 0 };
  if (!r.ownHold) {
    space.hold = r.needsHold ? m.holds.slice(1) : m.holds;
    start.hold = r.needsHold ? m.holds[Math.min(3, m.holds.length - 1)] : 0;
  }
  return { space, start };
}

// Signals and exit options for one asset.
export function build(s, bars, p) {
  const m = MARKETS[s.market];
  const sig = s.rule.signal(bars, p, m);
  return { enter: sig.enter, exit: sig.exit, opts: { cost: m.cost, stopPct: p.stop || 0, takePct: p.take || 0, maxHold: sig.maxHold ?? p.hold ?? 0, eod: !!s.rule.eod } };
}
