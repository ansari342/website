// Convert a Yahoo Finance chart API response into the compact series format
// the trading lab uses: { symbol, name, d, o, h, l, c, div }.
// Prices are split-adjusted but not dividend-adjusted; dividends are listed
// separately by ex-date so the simulator can credit them as cash.

const round = (x) => Math.round(x * 10000) / 10000;

export function normalizeYahoo(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) throw new Error("Unexpected price data format");
  const offset = r.meta.gmtoffset || 0;
  const day = (ts) => new Date((ts + offset) * 1000).toISOString().slice(0, 10);
  const q = r.indicators.quote[0];
  const out = { symbol: r.meta.symbol, name: r.meta.longName || r.meta.shortName || r.meta.symbol, d: [], o: [], h: [], l: [], c: [], div: {} };
  r.timestamp.forEach((ts, i) => {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if ([o, h, l, c].some((v) => v == null || !(v > 0))) return;
    const d = day(ts);
    if (out.d.length && out.d.at(-1) === d) return;
    out.d.push(d);
    out.o.push(round(o));
    out.h.push(round(Math.max(h, o, c)));
    out.l.push(round(Math.min(l, o, c)));
    out.c.push(round(c));
  });
  const divs = (r.events && r.events.dividends) || {};
  for (const k of Object.keys(divs)) {
    const v = divs[k];
    if (v && v.amount > 0) out.div[day(v.date)] = round(v.amount);
  }
  return out;
}
