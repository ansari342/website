// Three long-only, cash-only strategies. None use margin, short selling,
// options, futures or interest, and they only trade what the user selects
// from a shariah-screened list.

import { sma, rsi, roc } from "./indicators.js";

const pct = (v) => v / 100;

export const dipBuyer = {
  id: "dip",
  name: "Dip Buyer",
  tagline: "Buy sharp pullbacks inside long-term uptrends, sell on the bounce.",
  idea:
    "Short, sharp drops in a market that is still in a long-term uptrend have tended to bounce back within days. The edge is small per trade, but it shows up often. It sits in cash most of the time, so the yearly return is modest; the strength is the steady win rate and small drops.",
  rules: [
    "Only consider a fund when its close is above its 200-day average (long-term uptrend).",
    "Buy at the next open when the 2-day RSI closes below the entry level (a sharp short-term drop).",
    "Sell at the next open after the close rises above the 5-day average, or after the maximum holding period.",
    "A protective stop sells the position if it falls too far from the entry price.",
  ],
  fields: [
    { key: "entryRsi", label: "Entry: 2-day RSI below", default: 15, min: 1, max: 40, step: 1 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 10 },
    { key: "exitLen", label: "Exit above average of (days)", default: 5, min: 2, max: 20, step: 1 },
    { key: "maxHold", label: "Maximum holding period (days)", default: 10, min: 2, max: 40, step: 1 },
    { key: "stopPct", label: "Protective stop (%)", default: 10, min: 2, max: 30, step: 1 },
    { key: "maxPositions", label: "Maximum positions at once", default: 2, min: 1, max: 10, step: 1 },
  ],
  prepare(s, p) {
    return { trend: sma(s.c, p.trendLen), exit: sma(s.c, p.exitLen), rsi: rsi(s.c, 2) };
  },
  onClose(ctx) {
    const { params: p, series, ind } = ctx;
    const orders = [];
    let slots = p.maxPositions - ctx.positions.size;
    for (const [s] of ctx.positions) {
      const i = ctx.bar(s);
      if (i < 0) continue;
      const c = series[s].c[i];
      if (ind[s].exit[i] != null && c > ind[s].exit[i]) { orders.push({ side: "sell", sym: s, reason: "bounce" }); slots++; }
      else if (ctx.daysHeld(s) >= p.maxHold) { orders.push({ side: "sell", sym: s, reason: "time limit" }); slots++; }
    }
    const candidates = ctx.symbols
      .filter((s) => !ctx.held(s))
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && ind[s].trend[i] != null && ind[s].rsi[i] != null && series[s].c[i] > ind[s].trend[i] && ind[s].rsi[i] < p.entryRsi)
      .sort((a, b) => ind[a.s].rsi[a.i] - ind[b.s].rsi[b.i]);
    for (const { s, i } of candidates.slice(0, Math.max(0, slots))) {
      orders.push({ side: "buy", sym: s, weight: 1 / p.maxPositions, stopPct: pct(p.stopPct), reason: `RSI ${ind[s].rsi[i].toFixed(1)}` });
    }
    return orders;
  },
};

export const trendGuard = {
  id: "guard",
  name: "Trend Guard",
  tagline: "Hold a broad halal index fund while it's in an uptrend. Step aside into sukuk or cash when it isn't.",
  idea:
    "Most of the market's worst losses have come during long downtrends. Staying invested while the index is above its long-term average, and stepping aside when it falls below, has historically given up a little return in exchange for much smaller crashes.",
  rules: [
    "Check once a month, on the last trading day.",
    "Hold the core fund (the first selected fund) while its close is above the 200-day average plus a small buffer.",
    "When it closes below the average minus the buffer, sell and move into the sukuk fund (SPSK) if sukuk is trending up, otherwise hold cash.",
    "The buffer stops the strategy from flipping back and forth around the line.",
  ],
  fields: [
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 10 },
    { key: "band", label: "Buffer around the average (%)", default: 2, min: 0, max: 5, step: 0.5 },
    { key: "useDefensive", label: "Use sukuk fund when defensive (1 = yes)", default: 1, min: 0, max: 1, step: 1 },
  ],
  requires(p) {
    return p.useDefensive ? ["SPSK"] : [];
  },
  prepare(s, p) {
    return { trend: sma(s.c, p.trendLen), mom63: roc(s.c, 63) };
  },
  onClose(ctx) {
    if (!ctx.lastOfMonth) return [];
    const { params: p, series, ind } = ctx;
    const defensive = "SPSK";
    const core = ctx.symbols.find((s) => s !== defensive);
    if (!core) return [];
    const i = ctx.bar(core);
    if (i < 0 || ind[core].trend[i] == null) return [];
    const c = series[core].c[i];
    const avg = ind[core].trend[i];
    const inCore = ctx.held(core);
    const riskOn = inCore ? c > avg * (1 - pct(p.band)) : c > avg * (1 + pct(p.band));
    const orders = [];
    if (riskOn) {
      if (ctx.held(defensive)) orders.push({ side: "sell", sym: defensive, reason: "back to uptrend" });
      if (!inCore) orders.push({ side: "buy", sym: core, weight: 1, reason: "above trend" });
    } else {
      if (inCore) orders.push({ side: "sell", sym: core, reason: "below trend" });
      if (p.useDefensive && series[defensive]) {
        const j = ctx.bar(defensive);
        const ok = j >= 0 && ind[defensive]?.mom63?.[j] > 0;
        if (ok && !ctx.held(defensive)) orders.push({ side: "buy", sym: defensive, weight: 1, reason: "defensive (sukuk)" });
        if (!ok && ctx.held(defensive)) orders.push({ side: "sell", sym: defensive, reason: "sukuk weak, to cash" });
      }
    }
    return orders;
  },
};

export const gapFill = {
  id: "gap",
  name: "Gap Fill",
  experimental: true,
  verdict:
    "Failed the test. It wins most trades, but the losing days are bigger than the winning ones, and trading costs eat the small average gain. It's kept here so you can see why a high win rate alone isn't enough.",
  tagline: "When a fund opens well below yesterday's close, buy and aim for part of the gap to close by end of day.",
  idea:
    "Overnight gaps down are often an overreaction. In an uptrend, part of the gap has tended to recover during the same day. Positions are opened and closed on the same day, so there is no overnight risk.",
  rules: [
    "Only consider a fund when yesterday's close was above its 200-day average.",
    "Buy at the open when the fund opens between the minimum and maximum gap below yesterday's close (very large gaps usually mean real news, so they are skipped).",
    "Sell at the target, which is part of the way back to yesterday's close.",
    "If the target isn't reached, sell at the close. A stop limits the loss on the day.",
  ],
  fields: [
    { key: "minGap", label: "Minimum gap down (%)", default: 0.5, min: 0.1, max: 5, step: 0.1 },
    { key: "maxGap", label: "Maximum gap down (%)", default: 4, min: 1, max: 10, step: 0.5 },
    { key: "fillPct", label: "Target: share of gap filled (%)", default: 50, min: 10, max: 100, step: 5 },
    { key: "stopPct", label: "Stop below entry (%)", default: 2, min: 0.5, max: 10, step: 0.5 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 10 },
    { key: "maxPositions", label: "Maximum positions at once", default: 3, min: 1, max: 10, step: 1 },
  ],
  prepare(s, p) {
    return { trend: sma(s.c, p.trendLen) };
  },
  onOpen(ctx) {
    const { params: p, series, ind } = ctx;
    const slots = p.maxPositions - ctx.positions.size;
    if (slots <= 0) return [];
    const picks = [];
    for (const s of ctx.symbols) {
      if (ctx.held(s)) continue;
      const i = ctx.bar(s);
      if (i < 1) continue;
      const prev = series[s].c[i - 1];
      const open = series[s].o[i];
      const trend = ind[s].trend[i - 1];
      const gap = open / prev - 1;
      if (trend == null || prev <= trend) continue;
      if (gap <= -pct(p.minGap) && gap >= -pct(p.maxGap)) picks.push({ s, gap, prev, open });
    }
    picks.sort((a, b) => a.gap - b.gap);
    return picks.slice(0, slots).map(({ s, gap, prev, open }) => ({
      side: "buy",
      sym: s,
      weight: 1 / p.maxPositions,
      target: open + (prev - open) * pct(p.fillPct),
      stopPct: pct(p.stopPct),
      reason: `gap ${(gap * 100).toFixed(2)}%`,
    }));
  },
  onClose(ctx) {
    return [...ctx.positions.keys()].map((s) => ({ side: "sell", sym: s, when: "close", reason: "end of day" }));
  },
};

export const trendRotation = {
  id: "rotation",
  name: "Trend Rotation",
  tagline: "Each month, hold the strongest trending funds. Step aside into sukuk or cash when nothing is trending.",
  idea:
    "Markets that have been rising tend to keep rising for a while (momentum), and trend filters have historically kept investors out of the worst of long bear markets. It trades rarely and aims for smaller drawdowns, not a high win rate.",
  rules: [
    "On the last trading day of each month, rank the selected funds by their return over the lookback period.",
    "Hold the top funds whose return is positive and whose price is above the 200-day average, in equal weights.",
    "Put any unfilled slots into the defensive sukuk fund (SPSK) if it is trending up, otherwise keep them as cash.",
    "Orders fill at the next day's open.",
  ],
  fields: [
    { key: "lookback", label: "Momentum lookback (days)", default: 126, min: 20, max: 252, step: 1 },
    { key: "trendLen", label: "Trend filter (days)", default: 200, min: 50, max: 300, step: 10 },
    { key: "top", label: "Funds to hold", default: 2, min: 1, max: 5, step: 1 },
    { key: "useDefensive", label: "Use sukuk fund when defensive (1 = yes)", default: 1, min: 0, max: 1, step: 1 },
  ],
  requires(p) {
    return p.useDefensive ? ["SPSK"] : [];
  },
  prepare(s, p) {
    return { mom: roc(s.c, p.lookback), trend: sma(s.c, p.trendLen), mom63: roc(s.c, 63) };
  },
  onClose(ctx) {
    if (!ctx.lastOfMonth) return [];
    const { params: p, series, ind } = ctx;
    const defensive = "SPSK";
    const ranked = ctx.symbols
      .filter((s) => s !== defensive)
      .map((s) => ({ s, i: ctx.bar(s) }))
      .filter(({ s, i }) => i >= 0 && ind[s].mom[i] != null && ind[s].trend[i] != null)
      .filter(({ s, i }) => ind[s].mom[i] > 0 && series[s].c[i] > ind[s].trend[i])
      .sort((a, b) => ind[b.s].mom[b.i] - ind[a.s].mom[a.i])
      .slice(0, p.top);
    const targets = new Map(ranked.map(({ s, i }) => [s, `momentum ${(ind[s].mom[i] * 100).toFixed(1)}%`]));
    const free = p.top - targets.size;
    if (free > 0 && p.useDefensive && series[defensive]) {
      const i = ctx.bar(defensive);
      if (i >= 0 && ind[defensive]?.mom63?.[i] > 0) targets.set(defensive, "defensive (sukuk)");
    }
    const weightOf = (s) => (s === defensive ? free / p.top : 1 / p.top);
    const orders = [];
    for (const [s] of ctx.positions) if (!targets.has(s)) orders.push({ side: "sell", sym: s, reason: "rotated out" });
    for (const [s, why] of targets) if (!ctx.held(s)) orders.push({ side: "buy", sym: s, weight: weightOf(s), reason: why });
    return orders;
  },
};

export const STRATEGIES = [dipBuyer, trendGuard, trendRotation, gapFill];
