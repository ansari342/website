// Market data for the simulator.
// 1. Live: /api/prices (a signed-in proxy to Yahoo Finance, on the deployed site).
// 2. Snapshot: daily bars bundled with the site, used when live data is unavailable.
// 3. Random: a synthetic market with no built-in edge, for stress tests.

import { mulberry32 } from "./stats.js";

// Shariah screening status changes over time. The ETFs are run to a Shariah
// standard with a supervisory board; the stocks are ones major screeners have
// commonly listed as compliant, but their status must be checked before trading.
export const UNIVERSE = [
  { sym: "SPUS", kind: "ETF", name: "SP Funds S&P 500 Sharia", note: "US large caps, Shariah-screened" },
  { sym: "HLAL", kind: "ETF", name: "Wahed FTSE USA Shariah", note: "US stocks, Shariah-screened" },
  { sym: "UMMA", kind: "ETF", name: "Wahed Dow Jones Islamic World", note: "Global ex-US, Shariah-screened" },
  { sym: "SPWO", kind: "ETF", name: "SP Funds S&P World", note: "Global, Shariah-screened" },
  { sym: "SPTE", kind: "ETF", name: "SP Funds S&P Global Technology", note: "Global tech, Shariah-screened" },
  { sym: "SPRE", kind: "ETF", name: "SP Funds S&P Global REIT Sharia", note: "Real estate, Shariah-screened" },
  { sym: "SPSK", kind: "Sukuk", name: "SP Funds Dow Jones Global Sukuk", note: "Islamic bonds (sukuk), the defensive asset" },
  { sym: "AAPL", kind: "Stock", name: "Apple", note: "Verify current screening" },
  { sym: "MSFT", kind: "Stock", name: "Microsoft", note: "Verify current screening" },
  { sym: "NVDA", kind: "Stock", name: "NVIDIA", note: "Verify current screening" },
  { sym: "ADBE", kind: "Stock", name: "Adobe", note: "Verify current screening" },
  { sym: "ASML", kind: "Stock", name: "ASML", note: "Verify current screening" },
  { sym: "TSM", kind: "Stock", name: "TSMC", note: "Verify current screening" },
];

export async function loadSeries(symbols, { source = "auto", seed = 1 } = {}) {
  if (source === "random") return { series: randomMarket(symbols, seed), source: "random", asOf: null };
  if (source === "auto" || source === "live") {
    try {
      const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`, { credentials: "same-origin" });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
        const body = await res.json();
        const series = body.series || {};
        if (symbols.every((s) => series[s])) return { series, source: "live", asOf: latest(series) };
      }
    } catch (_) {
      // Fall through to the snapshot.
    }
    if (source === "live") throw new Error("Live prices are unavailable right now.");
  }
  const entries = await Promise.all(
    symbols.map(async (s) => {
      const res = await fetch(`data/${s}.json`);
      if (!res.ok) throw new Error(`No snapshot data for ${s}`);
      return [s, await res.json()];
    })
  );
  const series = Object.fromEntries(entries);
  return { series, source: "snapshot", asOf: latest(series) };
}

function latest(series) {
  return Object.values(series).reduce((m, s) => (s.d.at(-1) > m ? s.d.at(-1) : m), "");
}

// A synthetic market: one shared market factor plus noise for each symbol,
// with calm and stormy volatility regimes and a modest upward drift. Daily
// returns are independent, so short-term patterns here are pure chance.
export function randomMarket(symbols, seed = 1, days = 1750) {
  const rand = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const dates = [];
  const d = new Date(Date.UTC(2019, 0, 2));
  while (dates.length < days) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  let stormy = false;
  const market = dates.map(() => {
    if (rand() < (stormy ? 0.02 : 0.005)) stormy = !stormy;
    const vol = stormy ? 0.022 : 0.009;
    return { drift: 0.0003, vol, z: gauss() };
  });
  const out = {};
  for (const s of symbols) {
    const isSukuk = s === "SPSK";
    const beta = isSukuk ? 0.1 : 0.8 + rand() * 0.4;
    let c = 50 + rand() * 50;
    const ser = { symbol: s, name: `${s} (random)`, d: [], o: [], h: [], l: [], c: [], div: {} };
    dates.forEach((date, i) => {
      const m = market[i];
      const idio = (isSukuk ? 0.002 : 0.008) * gauss();
      const r = (isSukuk ? 0.0001 : m.drift) + beta * m.vol * m.z + idio;
      const overnight = r * 0.4 + 0.002 * gauss() * (isSukuk ? 0.2 : 1);
      const open = c * Math.exp(overnight);
      const close = c * Math.exp(r);
      const wiggle = Math.abs(gauss()) * m.vol * 0.5 * (isSukuk ? 0.2 : 1);
      ser.d.push(date);
      ser.o.push(open);
      ser.c.push(close);
      ser.h.push(Math.max(open, close) * (1 + wiggle));
      ser.l.push(Math.min(open, close) * (1 - wiggle));
      c = close;
    });
    out[s] = ser;
  }
  return out;
}
