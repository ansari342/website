// Performance and probability statistics.

export function dailyReturns(equity) {
  const r = [];
  for (let i = 1; i < equity.length; i++) r.push(equity[i] / equity[i - 1] - 1);
  return r;
}

export function drawdowns(equity) {
  let peak = -Infinity;
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

// Wilson score interval for a proportion (95% by default).
export function wilson(wins, n, z = 1.96) {
  if (!n) return [0, 0];
  const ph = wins / n;
  const den = 1 + (z * z) / n;
  const mid = (ph + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export function summarize(result) {
  const { equity, dates, trades, exposure, capital } = result;
  const end = equity.at(-1);
  const years = Math.max((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / (365.25 * 864e5), 1 / 365);
  const rets = dailyReturns(equity);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1));
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    endValue: end,
    totalReturn: end / capital - 1,
    cagr: Math.pow(end / capital, 1 / years) - 1,
    maxDrawdown: Math.min(...drawdowns(equity)),
    volatility: sd * Math.sqrt(252),
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : 0,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    winCI: wilson(wins.length, trades.length),
    avgWin: wins.length ? wins.reduce((a, t) => a + t.ret, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.ret, 0) / losses.length : 0,
    expectancy: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgDays: trades.length ? trades.reduce((a, t) => a + t.days, 0) / trades.length : 0,
    exposure: exposure.reduce((a, b) => a + b, 0) / (exposure.length || 1),
    years,
  };
}

export function summarizeSeries(equity, dates, capital) {
  return summarize({ equity, dates, trades: [], exposure: equity.map(() => 1), capital });
}

// Small, fast, seedable random number generator.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Block bootstrap of daily returns: stitch together random 20-day blocks of
// the strategy's own history to build many alternative "years", and count how
// often the result is a gain. Blocks keep some of the streakiness of real markets.
export function bootstrapYears(equity, { horizon = 252, runs = 2000, block = 20, seed = 7 } = {}) {
  const rets = dailyReturns(equity);
  if (rets.length < block * 2) return null;
  const rand = mulberry32(seed);
  const outcomes = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let g = 1;
    let n = 0;
    while (n < horizon) {
      const start = Math.floor(rand() * (rets.length - block));
      for (let k = 0; k < block && n < horizon; k++, n++) g *= 1 + rets[start + k];
    }
    outcomes[r] = g - 1;
  }
  const sorted = [...outcomes].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    outcomes: sorted,
    pGain: sorted.filter((x) => x > 0).length / runs,
    pLoss10: sorted.filter((x) => x < -0.1).length / runs,
    p5: q(0.05),
    p50: q(0.5),
    p95: q(0.95),
  };
}

// Reality check: performance in the first half of the period vs the second.
export function splitHalves(equity, dates) {
  const mid = Math.floor(equity.length / 2);
  const part = (a, b) => {
    const e = equity.slice(a, b);
    const d = dates.slice(a, b);
    const years = Math.max((Date.parse(d.at(-1)) - Date.parse(d[0])) / (365.25 * 864e5), 1 / 365);
    return { from: d[0], to: d.at(-1), cagr: Math.pow(e.at(-1) / e[0], 1 / years) - 1, maxDrawdown: Math.min(...drawdowns(e)) };
  };
  return [part(0, mid + 1), part(mid, equity.length)];
}
