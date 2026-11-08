// Ten more long-only, cash-only strategies. Five are new ideas; five combine
// or vary the original four. Same rules as the others: no shorting, no
// borrowing, no options or futures, and idle cash earns nothing.

import { sma, rsi, roc } from "./indicators.js";

const pct = (v) => v / 100;

/* ---------- helpers ---------- */

function rollingMax(a, n) {
  return a.map((_, i) => (i >= n - 1 ? Math.max(...a.slice(i - n + 1, i + 1)) : null));
}
function rollingMin(a, n) {
  return a.map((_, i) => (i >= n - 1 ? Math.min(...a.slice(i - n + 1, i + 1)) : null));
}
function rollingStd(a, n) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let m = 0;
    for (let k = i - n + 1; k <= i; k++) m += a[k];
    m /= n;
    let v = 0;
    for (let k = i - n + 1; k <= i; k++) v += (a[k] - m) ** 2;
    out[i] = Math.sqrt(v / n);
  }
  return out;
}
// Annualized volatility of daily returns over n days. Crypto trades every
// day of the year, so it uses 365 days; markets use 252.
function annualVol(s, n) {
  const r = s.c.map((c, i) => (i ? c / s.c[i - 1] - 1 : 0));
  const sd = rollingStd(r, n);
  const weekend = s.d.slice(0, 30).some((d) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()));
  const k = Math.sqrt(weekend ? 365 : 252);
  return sd.map((v, i) => (v == null || i < n ? null : v * k));
}

// Sell-everything-not-in-target, buy-what's-missing helper for rebalancers.
function rebalance(ctx, targets, reasonOut = "rotated out") {
  const orders = [];
  for (const [s] of ctx.positions) if (!targets.has(s)) orders.push({ side: "sell", sym: s, reason: reasonOut });
  for (const [s, t] of targets) if (!ctx.held(s)) orders.push({ side: "buy", sym: s, weight: t.weight, reason: t.reason });
  return orders;
}

// Dip Buyer's entry test and exits, shared by its variations.
const dipSignal = (ctx, s, i, p) => {
  const { trend, rsi2 } = ctx.ind[s];
  return trend[i] != null && rsi2[i] != null && ctx.series[s].c[i] > trend[i] && rsi2[i] < p.entryRsi;
};
const dipExit = (ctx, s, i, p) => {
  const avg = ctx.ind[s].exit[i];
  if (avg != null && ctx.series[s].c[i] > avg) return "bounce";
  if (ctx.daysHeld(s) >= p.maxHold) return "time limit";
  return null;
};

/* ---------- 1. Breakout (new) ---------- */
export const breakout = {
  id: "breakout",
  name: "Breakout",
  kind: "new",
  tagline: "Buy a new N-day high; sell on a shorter-term new low.",
  idea: "Prices that break out to new highs often keep going for a while. This follows those breakouts and gets out when the move reverses to a new short-term low.",
  rules: [
    "Buy at the next open when the close is above the highest high of the previous entry-window days.",
    "Sell at the next open when the close is below the lowest low of the previous exit-window days.",
    "A protective stop limits the loss on each position.",
  ],
  fields: [
    { key: "entryLen", label: "Entry: new high over (days)", default: 55, min: 10, max: 150, step: 5 },
    { key: "exitLen", label: "Exit: new low over (days)", default: 20, min: 5, max: 60, step: 5 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Maximum positions", default: 3, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ hi: rollingMax(s.h, p.entryLen), lo: rollingMin(s.l, p.exitLen) }),
  onClose(ctx) {
    const { params: p, series, ind } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    for (const [s] of ctx.positions) {
      const i = ctx.bar(s);
      if (i > 0 && ind[s].lo[i - 1] != null && series[s].c[i] < ind[s].lo[i - 1]) { orders.push({ side: "sell", sym: s, reason: "new low" }); slots++; }
    }
    const picks = ctx.symbols
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i > 0 && !ctx.held(s) && ind[s].hi[i - 1] != null && series[s].c[i] > ind[s].hi[i - 1])
      .sort((a, b) => series[b.s].c[b.i] / ind[b.s].hi[b.i - 1] - series[a.s].c[a.i] / ind[a.s].hi[a.i - 1]);
    for (const { s } of picks.slice(0, Math.max(0, slots))) orders.push({ side: "buy", sym: s, weight: 1 / p.maxPositions, stopPct: pct(p.stopPct), reason: "breakout" });
    return orders;
  },
};

/* ---------- 2. Golden Cross (new) ---------- */
export const goldenCross = {
  id: "golden",
  name: "Golden Cross",
  kind: "new",
  tagline: "Hold each stock while its fast average is above its slow average.",
  idea: "A classic trend filter: when the 50-day average is above the 200-day average the trend is up, and the stock is held; when it crosses below, it's sold.",
  rules: [
    "Hold a stock while its fast moving average is above its slow one.",
    "Sell at the next open after the fast average drops below the slow one.",
    "Each holding gets an equal share; if more stocks qualify than there are slots, the strongest trends come first.",
  ],
  fields: [
    { key: "fast", label: "Fast average (days)", default: 50, min: 10, max: 100, step: 5 },
    { key: "slow", label: "Slow average (days)", default: 200, min: 50, max: 300, step: 10 },
    { key: "maxPositions", label: "Maximum positions", default: 3, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ f: sma(s.c, p.fast), sl: sma(s.c, p.slow) }),
  onClose(ctx) {
    const { params: p, ind } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    const up = (s, i) => i >= 0 && ind[s].f[i] != null && ind[s].sl[i] != null && ind[s].f[i] > ind[s].sl[i];
    for (const [s] of ctx.positions) if (!up(s, ctx.bar(s)) && ctx.bar(s) >= 0) { orders.push({ side: "sell", sym: s, reason: "fast below slow" }); slots++; }
    const picks = ctx.symbols
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => !ctx.held(s) && up(s, i))
      .sort((a, b) => ind[b.s].f[b.i] / ind[b.s].sl[b.i] - ind[a.s].f[a.i] / ind[a.s].sl[a.i]);
    for (const { s } of picks.slice(0, Math.max(0, slots))) orders.push({ side: "buy", sym: s, weight: 1 / p.maxPositions, reason: "golden cross" });
    return orders;
  },
};

/* ---------- 3. Volatility Target (new) ---------- */
export const volTarget = {
  id: "voltarget",
  name: "Volatility Target",
  kind: "new",
  tagline: "Hold the core fund, sized so its swings stay near a target.",
  idea: "When markets get stormy, hold less; when they're calm, hold more. Sizing the position by recent volatility has historically smoothed the ride and cut the deepest drops.",
  rules: [
    "Uses the first selected fund (marked 1) as the core holding.",
    "Each week, set the holding to target volatility ÷ recent volatility, capped at 100% of the account. The rest stays in cash.",
    "Only resize when the target differs from the current holding by more than the buffer, to limit trading.",
    "Optionally, hold nothing while the fund is below its long-term average.",
  ],
  fields: [
    { key: "targetVol", label: "Target yearly volatility (%)", default: 15, min: 5, max: 60, step: 1 },
    { key: "volLen", label: "Volatility lookback (days)", default: 20, min: 10, max: 120, step: 5 },
    { key: "buffer", label: "Resize only if off by more than (%)", default: 20, min: 5, max: 50, step: 5 },
    { key: "trendLen", label: "Trend filter (days, 0 = off)", default: 0, min: 0, max: 300, step: 25 },
  ],
  prepare: (s, p) => ({ vol: annualVol(s, p.volLen), trend: p.trendLen ? sma(s.c, p.trendLen) : null }),
  onClose(ctx) {
    if (!ctx.lastOfWeek) return [];
    const { params: p, ind, series } = ctx;
    const s = ctx.symbols[0];
    const i = ctx.bar(s);
    if (i < 0 || ind[s].vol[i] == null) return [];
    let w = Math.min(1, pct(p.targetVol) / Math.max(ind[s].vol[i], 1e-6));
    if (p.trendLen && ind[s].trend[i] != null && series[s].c[i] < ind[s].trend[i]) w = 0;
    const eq = ctx.equity();
    const cur = eq > 0 ? ctx.holdingValue(s) / eq : 0;
    if (Math.abs(w - cur) <= Math.max(pct(p.buffer) * Math.max(w, cur), 0.02)) return [];
    const orders = [];
    if (ctx.held(s)) orders.push({ side: "sell", sym: s, reason: "resize" });
    if (w > 0.01) orders.push({ side: "buy", sym: s, weight: w, reason: `${Math.round(w * 100)}% size` });
    return orders;
  },
};

/* ---------- 4. Calm Leaders (new) ---------- */
export const calmLeaders = {
  id: "lowvol",
  name: "Calm Leaders",
  kind: "new",
  tagline: "Each month, hold the least jumpy stocks that are in an uptrend.",
  idea: "Calmer stocks have historically delivered nearly as much return as jumpy ones with far smaller drops (the low-volatility effect). This holds the calmest of the stocks that are trending up.",
  rules: [
    "On the last trading day of each month, keep only stocks above their long-term average.",
    "Of those, hold the ones with the lowest recent volatility, in equal weights.",
    "If nothing is trending up, hold cash.",
  ],
  fields: [
    { key: "volLen", label: "Volatility lookback (days)", default: 60, min: 20, max: 250, step: 10 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "top", label: "Stocks to hold", default: 3, min: 1, max: 8, step: 1 },
  ],
  prepare: (s, p) => ({ vol: annualVol(s, p.volLen), trend: sma(s.c, p.trendLen) }),
  onClose(ctx) {
    if (!ctx.lastOfMonth) return [];
    const { params: p, ind, series } = ctx;
    const picks = ctx.symbols
      .filter((s) => s !== "SPSK")
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && ind[s].vol[i] != null && ind[s].trend[i] != null && series[s].c[i] > ind[s].trend[i])
      .sort((a, b) => ind[a.s].vol[a.i] - ind[b.s].vol[b.i])
      .slice(0, p.top);
    return rebalance(ctx, new Map(picks.map(({ s, i }) => [s, { weight: 1 / p.top, reason: `vol ${(ind[s].vol[i] * 100).toFixed(0)}%` }])));
  },
};

/* ---------- 5. Weekly Reversal (new) ---------- */
export const weeklyReversal = {
  id: "reversal",
  name: "Weekly Reversal",
  kind: "new",
  tagline: "Each week, buy last week's biggest losers that are still in uptrends.",
  idea: "Over a week or so, the biggest losers among otherwise healthy stocks have tended to bounce back (short-term reversal). This buys them at the end of the week and holds for one week.",
  rules: [
    "On the last trading day of each week, rank stocks above their long-term average by their return over the week.",
    "Hold the weakest few for the next week, in equal weights. Sell anything that no longer qualifies.",
    "A protective stop limits the loss on each position.",
  ],
  fields: [
    { key: "lookback", label: "Return lookback (days)", default: 5, min: 2, max: 20, step: 1 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "top", label: "Stocks to hold", default: 2, min: 1, max: 6, step: 1 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
  ],
  prepare: (s, p) => ({ r: roc(s.c, p.lookback), trend: sma(s.c, p.trendLen) }),
  onClose(ctx) {
    if (!ctx.lastOfWeek) return [];
    const { params: p, ind, series } = ctx;
    const picks = ctx.symbols
      .filter((s) => s !== "SPSK")
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && ind[s].r[i] != null && ind[s].trend[i] != null && series[s].c[i] > ind[s].trend[i] && ind[s].r[i] < 0)
      .sort((a, b) => ind[a.s].r[a.i] - ind[b.s].r[b.i])
      .slice(0, p.top);
    const orders = rebalance(ctx, new Map(picks.map(({ s, i }) => [s, { weight: 1 / p.top, reason: `week ${(ind[s].r[i] * 100).toFixed(1)}%` }])), "week over");
    return orders.map((o) => (o.side === "buy" ? { ...o, stopPct: pct(p.stopPct) } : o));
  },
};

/* ---------- 6. Band Bounce (Dip Buyer variation) ---------- */
export const bandBounce = {
  id: "bands",
  name: "Band Bounce",
  kind: "permutation",
  tagline: "Buy below the lower Bollinger band in an uptrend; sell back at the middle.",
  idea: "A different way to spot an oversold dip: the price falls more than a set number of standard deviations below its 20-day average. Like Dip Buyer, it only buys in long-term uptrends and sells on the snap-back.",
  rules: [
    "Buy at the next open when the close is below the lower band (average minus k standard deviations) and above the long-term average.",
    "Sell at the next open when the close gets back to the middle band (the average), after the maximum holding period, or at the stop.",
  ],
  fields: [
    { key: "len", label: "Band length (days)", default: 20, min: 5, max: 50, step: 5 },
    { key: "k", label: "Band width (standard deviations)", default: 2, min: 1, max: 3, step: 0.25 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "maxHold", label: "Maximum holding period (days)", default: 15, min: 3, max: 40, step: 1 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Maximum positions", default: 3, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ mid: sma(s.c, p.len), sd: rollingStd(s.c, p.len), trend: sma(s.c, p.trendLen) }),
  onClose(ctx) {
    const { params: p, ind, series } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    for (const [s] of ctx.positions) {
      const i = ctx.bar(s);
      if (i < 0) continue;
      if (series[s].c[i] >= ind[s].mid[i]) { orders.push({ side: "sell", sym: s, reason: "back to middle" }); slots++; }
      else if (ctx.daysHeld(s) >= p.maxHold) { orders.push({ side: "sell", sym: s, reason: "time limit" }); slots++; }
    }
    const below = (s, i) => (ind[s].mid[i] - series[s].c[i]) / ind[s].sd[i];
    const picks = ctx.symbols
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && !ctx.held(s) && ind[s].sd[i] && ind[s].trend[i] != null && series[s].c[i] > ind[s].trend[i] && series[s].c[i] < ind[s].mid[i] - p.k * ind[s].sd[i])
      .sort((a, b) => below(b.s, b.i) - below(a.s, a.i));
    for (const { s, i } of picks.slice(0, Math.max(0, slots))) orders.push({ side: "buy", sym: s, weight: 1 / p.maxPositions, stopPct: pct(p.stopPct), reason: `${below(s, i).toFixed(1)} sd below` });
    return orders;
  },
};

/* ---------- 7. Momentum Dips (Dip Buyer × Trend Rotation) ---------- */
export const momentumDips = {
  id: "momdip",
  name: "Momentum Dips",
  kind: "permutation",
  tagline: "Dip Buyer, but only on the stocks with the strongest momentum.",
  idea: "Combines two ideas: buy short, sharp dips (Dip Buyer) only in the market's strongest stocks (Trend Rotation's momentum ranking), where pullbacks are most likely to be bought back.",
  rules: [
    "Rank stocks by their return over the momentum lookback; only the top few are eligible.",
    "Among those, buy at the next open when the 2-day RSI drops below the entry level and the stock is above its long-term average.",
    "Sell like Dip Buyer: on a close above the short average, after the maximum holding period, or at the stop.",
  ],
  fields: [
    { key: "lookback", label: "Momentum lookback (days)", default: 126, min: 20, max: 252, step: 21 },
    { key: "topK", label: "Eligible top stocks", default: 3, min: 1, max: 8, step: 1 },
    { key: "entryRsi", label: "Entry: 2-day RSI below", default: 15, min: 1, max: 40, step: 1 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "exitLen", label: "Exit above average of (days)", default: 5, min: 2, max: 20, step: 1 },
    { key: "maxHold", label: "Maximum holding period (days)", default: 10, min: 2, max: 40, step: 1 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Maximum positions", default: 2, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ mom: roc(s.c, p.lookback), trend: sma(s.c, p.trendLen), rsi2: rsi(s.c, 2), exit: sma(s.c, p.exitLen) }),
  onClose(ctx) {
    const { params: p, ind } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    for (const [s] of ctx.positions) {
      const i = ctx.bar(s);
      const why = i >= 0 ? dipExit(ctx, s, i, p) : null;
      if (why) { orders.push({ side: "sell", sym: s, reason: why }); slots++; }
    }
    const top = new Set(
      ctx.symbols
        .map((s) => ({ s, i: ctx.bar(s) }))
        .filter(({ s, i }) => i >= 0 && ind[s].mom[i] != null)
        .sort((a, b) => ind[b.s].mom[b.i] - ind[a.s].mom[a.i])
        .slice(0, p.topK)
        .map((x) => x.s)
    );
    const picks = [...top].map((s) => ({ s, i: ctx.bar(s) })).filter(({ s, i }) => !ctx.held(s) && dipSignal(ctx, s, i, p));
    for (const { s, i } of picks.slice(0, Math.max(0, slots))) orders.push({ side: "buy", sym: s, weight: 1 / p.maxPositions, stopPct: pct(p.stopPct), reason: `top-${p.topK} dip, RSI ${ind[s].rsi2[i].toFixed(0)}` });
    return orders;
  },
};

/* ---------- 8. Core + Dips (Trend Guard × Dip Buyer) ---------- */
export const coreDips = {
  id: "coredip",
  name: "Core + Dips",
  kind: "permutation",
  tagline: "Most of the money rides the core fund's uptrend; the rest buys dips.",
  idea: "Combines Trend Guard and Dip Buyer: a core holding in the first selected fund while it's above its long-term average, plus a smaller dip-buying sleeve across the other stocks to put idle cash to work.",
  rules: [
    "Core: on the last trading day of each month, hold the first selected fund (marked 1) at the core share while it's above its long-term average (with a buffer); otherwise sell it.",
    "Dips: with the rest of the money, run Dip Buyer on the other selected stocks.",
  ],
  fields: [
    { key: "coreWeight", label: "Core share of the account (%)", default: 60, min: 0, max: 90, step: 5 },
    { key: "coreTrend", label: "Core trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "band", label: "Core buffer around the average (%)", default: 2, min: 0, max: 5, step: 0.5 },
    { key: "entryRsi", label: "Dips: 2-day RSI below", default: 15, min: 1, max: 40, step: 1 },
    { key: "trendLen", label: "Dips: trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "exitLen", label: "Dips: exit above average of (days)", default: 5, min: 2, max: 20, step: 1 },
    { key: "maxHold", label: "Dips: maximum holding period (days)", default: 10, min: 2, max: 40, step: 1 },
    { key: "stopPct", label: "Dips: protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Dips: maximum positions", default: 2, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ core: sma(s.c, p.coreTrend), trend: sma(s.c, p.trendLen), rsi2: rsi(s.c, 2), exit: sma(s.c, p.exitLen) }),
  onClose(ctx) {
    const { params: p, ind, series } = ctx;
    const core = ctx.symbols[0];
    const orders = [];
    // Core sleeve, checked monthly.
    if (ctx.lastOfMonth) {
      const i = ctx.bar(core);
      if (i >= 0 && ind[core].core[i] != null) {
        const c = series[core].c[i];
        const avg = ind[core].core[i];
        const on = ctx.held(core) ? c > avg * (1 - pct(p.band)) : c > avg * (1 + pct(p.band));
        if (on && !ctx.held(core) && p.coreWeight > 0) orders.push({ side: "buy", sym: core, weight: pct(p.coreWeight), reason: "core: above trend" });
        if (!on && ctx.held(core)) orders.push({ side: "sell", sym: core, reason: "core: below trend" });
      }
    }
    // Dip sleeve on the other stocks.
    const dipSyms = ctx.symbols.slice(1);
    const heldDips = [...ctx.positions.keys()].filter((s) => s !== core);
    let slots = p.maxPositions - heldDips.length;
    for (const s of heldDips) {
      const i = ctx.bar(s);
      const why = i >= 0 ? dipExit(ctx, s, i, p) : null;
      if (why) { orders.push({ side: "sell", sym: s, reason: why }); slots++; }
    }
    const sleeve = (1 - pct(p.coreWeight)) / p.maxPositions;
    const picks = dipSyms.map((s) => ({ s, i: ctx.bar(s) })).filter(({ s, i }) => i >= 0 && !ctx.held(s) && dipSignal(ctx, s, i, p)).sort((a, b) => ind[a.s].rsi2[a.i] - ind[b.s].rsi2[b.i]);
    for (const { s, i } of picks.slice(0, Math.max(0, slots))) orders.push({ side: "buy", sym: s, weight: sleeve, stopPct: pct(p.stopPct), reason: `dip, RSI ${ind[s].rsi2[i].toFixed(0)}` });
    return orders;
  },
};

/* ---------- 9. Dual Momentum (Trend Rotation variation) ---------- */
export const dualMomentum = {
  id: "dualmom",
  name: "Dual Momentum",
  kind: "permutation",
  tagline: "Hold the best 12-month performer if it's up; otherwise sukuk or cash.",
  idea: "Relative momentum picks the strongest stock; absolute momentum checks it's actually rising. Together they've historically captured most of a bull market and sidestepped much of a bear market.",
  rules: [
    "On the last trading day of each month, rank the selected stocks by their return over the lookback.",
    "Hold the top few whose return is positive, in equal weights.",
    "Put any empty slots into sukuk (SPSK) if it's rising, otherwise hold cash.",
  ],
  fields: [
    { key: "lookback", label: "Momentum lookback (days)", default: 252, min: 21, max: 252, step: 21 },
    { key: "top", label: "Stocks to hold", default: 1, min: 1, max: 5, step: 1 },
    { key: "useDefensive", label: "Use sukuk fund when defensive (1 = yes)", default: 1, min: 0, max: 1, step: 1 },
  ],
  requires: (p) => (p.useDefensive ? ["SPSK"] : []),
  prepare: (s, p) => ({ mom: roc(s.c, p.lookback), mom63: roc(s.c, 63) }),
  onClose(ctx) {
    if (!ctx.lastOfMonth) return [];
    const { params: p, ind, series } = ctx;
    const ranked = ctx.symbols
      .filter((s) => s !== "SPSK")
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && ind[s].mom[i] != null && ind[s].mom[i] > 0)
      .sort((a, b) => ind[b.s].mom[b.i] - ind[a.s].mom[a.i])
      .slice(0, p.top);
    const targets = new Map(ranked.map(({ s, i }) => [s, { weight: 1 / p.top, reason: `momentum ${(ind[s].mom[i] * 100).toFixed(0)}%` }]));
    const free = p.top - targets.size;
    if (free > 0 && p.useDefensive && series.SPSK) {
      const j = ctx.bar("SPSK");
      if (j >= 0 && ind.SPSK?.mom63?.[j] > 0) targets.set("SPSK", { weight: free / p.top, reason: "defensive (sukuk)" });
    }
    return rebalance(ctx, targets);
  },
};

/* ---------- 10. Calm-Sized Dips (Dip Buyer variation) ---------- */
export const calmDips = {
  id: "voldip",
  name: "Calm-Sized Dips",
  kind: "permutation",
  tagline: "Dip Buyer that bets more on calm stocks and less on jumpy ones.",
  idea: "Same entries and exits as Dip Buyer, but each position is sized so every trade carries a similar amount of risk: a calm fund gets a bigger position, a wild stock a smaller one.",
  rules: [
    "Buy like Dip Buyer: a sharp 2-day RSI drop while above the long-term average.",
    "Size each position as target volatility ÷ the stock's recent volatility, split across the maximum positions, capped at 100%.",
    "Sell like Dip Buyer.",
  ],
  fields: [
    { key: "targetVol", label: "Target yearly volatility per position (%)", default: 20, min: 5, max: 80, step: 5 },
    { key: "entryRsi", label: "Entry: 2-day RSI below", default: 15, min: 1, max: 40, step: 1 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 25 },
    { key: "exitLen", label: "Exit above average of (days)", default: 5, min: 2, max: 20, step: 1 },
    { key: "maxHold", label: "Maximum holding period (days)", default: 10, min: 2, max: 40, step: 1 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Maximum positions", default: 2, min: 1, max: 10, step: 1 },
  ],
  prepare: (s, p) => ({ vol: annualVol(s, 20), trend: sma(s.c, p.trendLen), rsi2: rsi(s.c, 2), exit: sma(s.c, p.exitLen) }),
  onClose(ctx) {
    const { params: p, ind } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    for (const [s] of ctx.positions) {
      const i = ctx.bar(s);
      const why = i >= 0 ? dipExit(ctx, s, i, p) : null;
      if (why) { orders.push({ side: "sell", sym: s, reason: why }); slots++; }
    }
    const picks = ctx.symbols.map((s) => ({ s, i: ctx.bar(s) })).filter(({ s, i }) => i >= 0 && !ctx.held(s) && ind[s].vol[i] && dipSignal(ctx, s, i, p)).sort((a, b) => ind[a.s].rsi2[a.i] - ind[b.s].rsi2[b.i]);
    for (const { s, i } of picks.slice(0, Math.max(0, slots))) {
      const w = Math.min(1, pct(p.targetVol) / ind[s].vol[i]) / p.maxPositions;
      orders.push({ side: "buy", sym: s, weight: w, stopPct: pct(p.stopPct), reason: `dip, ${Math.round(w * 100)}% size` });
    }
    return orders;
  },
};

export const MORE_STRATEGIES = [breakout, goldenCross, volTarget, calmLeaders, weeklyReversal, bandBounce, momentumDips, coreDips, dualMomentum, calmDips];
