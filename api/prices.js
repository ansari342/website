// GET /api/prices?symbols=SPUS,HLAL
// Fresh daily prices from Yahoo Finance for the trading lab. Protected by the
// middleware, so only a signed-in user can call it. Responses are cached at the
// edge for a few hours.

import { normalizeYahoo } from "../lib/yahoo.js";

export const config = { runtime: "edge" };

const ALLOWED = new Set(["SPUS", "HLAL", "UMMA", "SPWO", "SPTE", "SPRE", "SPSK", "AAPL", "MSFT", "NVDA", "ADBE", "ASML", "TSM"]);

async function fetchSymbol(sym) {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=1546300800&period2=${now}&interval=1d&events=div%7Csplit`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (personal trading lab)" } });
  if (!res.ok) throw new Error(`${sym}: HTTP ${res.status}`);
  return normalizeYahoo(await res.json());
}

export default async function handler(request) {
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))];
  if (!symbols.length || symbols.length > 13 || symbols.some((s) => !ALLOWED.has(s))) {
    return new Response(JSON.stringify({ error: "Unknown or too many symbols" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  try {
    const list = await Promise.all(symbols.map(fetchSymbol));
    const series = Object.fromEntries(list.map((s) => [s.symbol, s]));
    return new Response(JSON.stringify({ series }), {
      headers: { "content-type": "application/json", "cache-control": "private, max-age=3600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), { status: 502, headers: { "content-type": "application/json" } });
  }
}
