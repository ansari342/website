// Daily backtest engine.
//
// Rules that keep the simulation honest:
// - No look-ahead. A strategy's onOpen hook sees today's open and earlier bars
//   only; onClose sees today's full bar. Orders placed at the close fill at the
//   next open unless they are explicitly "close" orders.
// - Long only, cash only: no margin, no shorting, no leverage. A buy can never
//   spend more cash than the account holds.
// - Idle cash earns nothing (no interest).
// - Every fill pays slippage. Stops that gap through fill at the open.
// - When a stop and a target could both trigger on the same day, the stop is
//   assumed to hit first.
//
// Series format: { d: ["YYYY-MM-DD"...], o: [], h: [], l: [], c: [], div: { date: amount } }

export function runBacktest({
  series,
  symbols,
  strategy,
  params = {},
  capital = 10000,
  slippageBps = 5,
  startDate = null,
  endDate = null,
  benchmark = null,
}) {
  const p = { ...defaultsOf(strategy), ...params };
  const syms = [...new Set([...symbols, ...(strategy.requires ? strategy.requires(p) : [])])].filter((s) => series[s]);
  if (!syms.length) throw new Error("No price data for the selected symbols.");
  const slip = slippageBps / 10000;

  // Calendar: every date on which any traded symbol has a bar, inside the window.
  const dateSet = new Set();
  for (const s of syms) for (const d of series[s].d) dateSet.add(d);
  let cal = [...dateSet].sort();
  if (startDate) cal = cal.filter((d) => d >= startDate);
  if (endDate) cal = cal.filter((d) => d <= endDate);
  if (cal.length < 2) throw new Error("Not enough data in the selected period.");

  const index = {};
  for (const s of syms) {
    const m = new Map();
    series[s].d.forEach((d, i) => m.set(d, i));
    index[s] = m;
  }
  const ind = {};
  for (const s of syms) ind[s] = strategy.prepare ? strategy.prepare(series[s], p) : {};

  let cash = capital;
  const positions = new Map(); // sym -> { qty, cost, entryPrice, entryDate, entryT, stop, target, divs, reason }
  const trades = [];
  const equity = [];
  const exposure = [];
  let pending = [];
  let dividends = 0;
  const lastClose = {};

  const barIndex = (s, date) => {
    const i = index[s].get(date);
    return i === undefined ? -1 : i;
  };

  const markValue = (priceOf) => {
    let v = cash;
    for (const [s, pos] of positions) v += pos.qty * priceOf(s);
    return v;
  };

  const sell = (s, rawPx, date, t, why) => {
    const pos = positions.get(s);
    if (!pos) return;
    const px = rawPx * (1 - slip);
    const proceeds = pos.qty * px;
    cash += proceeds;
    positions.delete(s);
    const pnl = proceeds + pos.divs - pos.cost;
    trades.push({
      sym: s,
      entryDate: pos.entryDate,
      entryPrice: pos.entryPrice,
      exitDate: date,
      exitPrice: px,
      qty: pos.qty,
      pnl,
      ret: pnl / pos.cost,
      days: t - pos.entryT,
      entryReason: pos.reason,
      exitReason: why,
    });
  };

  const buy = (o, rawPx, date, t, equityNow) => {
    if (positions.has(o.sym)) return;
    const alloc = Math.min(cash, (o.weight ?? 1) * equityNow);
    if (alloc < 1) return;
    const px = rawPx * (1 + slip);
    cash -= alloc;
    positions.set(o.sym, {
      qty: alloc / px,
      cost: alloc,
      entryPrice: px,
      entryDate: date,
      entryT: t,
      stop: o.stopPct ? px * (1 - o.stopPct) : o.stop ?? null,
      target: o.target ?? null,
      divs: 0,
      reason: o.reason || "",
    });
  };

  // Execute a batch at one price point (open or close): sells first, then buys.
  const execute = (orders, field, date, t) => {
    const priced = (s) => {
      const i = barIndex(s, date);
      return i >= 0 ? series[s][field][i] : null;
    };
    const carry = [];
    for (const o of orders.filter((o) => o.side === "sell")) {
      const px = priced(o.sym);
      if (px == null) { carry.push(o); continue; }
      sell(o.sym, px, date, t, o.reason || "signal");
    }
    const eq = markValue((s) => priced(s) ?? lastClose[s] ?? 0);
    for (const o of orders.filter((o) => o.side === "buy")) {
      const px = priced(o.sym);
      if (px == null) { carry.push(o); continue; }
      buy(o, px, date, t, eq);
    }
    return carry;
  };

  for (let t = 0; t < cal.length; t++) {
    const date = cal[t];
    const prevDate = t > 0 ? cal[t - 1] : null;
    const nextDate = t < cal.length - 1 ? cal[t + 1] : null;
    const ctx = {
      t,
      date,
      params: p,
      series,
      ind,
      symbols: symbols.filter((s) => series[s]),
      positions,
      bar: (s) => barIndex(s, date),
      held: (s) => positions.has(s),
      firstOfMonth: !prevDate || prevDate.slice(0, 7) !== date.slice(0, 7),
      lastOfMonth: nextDate !== null && nextDate.slice(0, 7) !== date.slice(0, 7),
      isLastDay: nextDate === null,
      daysHeld: (s) => (positions.has(s) ? t - positions.get(s).entryT : 0),
    };

    // 1. Orders queued at yesterday's close fill at today's open.
    pending = execute(pending, "o", date, t);

    // 2. Stops that gapped through overnight fill at the open.
    for (const [s, pos] of [...positions]) {
      const i = barIndex(s, date);
      if (i >= 0 && pos.stop != null && series[s].o[i] <= pos.stop) sell(s, series[s].o[i], date, t, "stop (gap)");
    }

    // 3. Strategy decisions at the open.
    if (strategy.onOpen) execute(strategy.onOpen(ctx) || [], "o", date, t);

    // 4. Intraday stops and targets.
    for (const [s, pos] of [...positions]) {
      const i = barIndex(s, date);
      if (i < 0) continue;
      const { o, h, l } = { o: series[s].o[i], h: series[s].h[i], l: series[s].l[i] };
      if (pos.stop != null && l <= pos.stop) sell(s, Math.min(pos.stop, o), date, t, "stop");
      else if (pos.target != null && h >= pos.target) sell(s, Math.max(pos.target, o), date, t, "target");
    }

    // 5. Dividends on the ex-date go to positions held before today.
    for (const [s, pos] of positions) {
      const amt = series[s].div && series[s].div[date];
      if (amt && pos.entryT < t) {
        const cashIn = amt * pos.qty;
        cash += cashIn;
        pos.divs += cashIn;
        dividends += cashIn;
      }
    }

    // 6. Strategy decisions at the close.
    for (const s of syms) {
      const i = barIndex(s, date);
      if (i >= 0) lastClose[s] = series[s].c[i];
    }
    if (strategy.onClose) {
      const orders = strategy.onClose(ctx) || [];
      execute(orders.filter((o) => o.when === "close"), "c", date, t);
      pending.push(...orders.filter((o) => o.when !== "close"));
    }

    // 7. Mark to market at the close.
    const value = markValue((s) => lastClose[s] ?? 0);
    equity.push(value);
    exposure.push(value > 0 ? (value - cash) / value : 0);
  }

  const open = [...positions].map(([sym, pos]) => {
    const px = lastClose[sym];
    const value = pos.qty * px;
    return { sym, entryDate: pos.entryDate, entryPrice: pos.entryPrice, price: px, value, ret: (value + pos.divs) / pos.cost - 1 };
  });

  return {
    dates: cal,
    equity,
    exposure,
    trades,
    open,
    dividends,
    capital,
    benchmark: benchmark && series[benchmark] ? buyAndHold(series[benchmark], cal, capital, slip) : null,
    params: p,
  };
}

// Buy on the first day, hold to the end. Dividends are kept as cash.
export function buyAndHold(s, cal, capital, slip = 0) {
  const idx = new Map(s.d.map((d, i) => [d, i]));
  let qty = 0;
  let cash = capital;
  let last = null;
  let bought = false;
  const out = [];
  for (const date of cal) {
    const i = idx.get(date);
    if (i !== undefined) {
      if (!bought) {
        qty = cash / (s.o[i] * (1 + slip));
        cash = 0;
        bought = true;
      } else if (s.div && s.div[date]) {
        cash += s.div[date] * qty;
      }
      last = s.c[i];
    }
    out.push(bought ? cash + qty * last : capital);
  }
  return out;
}

export function defaultsOf(strategy) {
  const d = {};
  for (const f of strategy.fields || []) d[f.key] = f.default;
  return d;
}
