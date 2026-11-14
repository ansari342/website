// The 100-strategy lab. Tunes every strategy by hill climbing on return over
// the tuning years, ranks them on a separate validation period, and reports
// the final result on a test period nothing was tuned or chosen on.
//
// Usage:
//   bash scripts/lab100-fetch.sh <data folder>
//   node scripts/lab100.mjs <data folder> <market>     (c5, c1h, e1h, ed, cd; one process each)
//   node scripts/lab100.mjs <data folder> merge        (writes trading/data/lab100.json)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { makeBars, aggregate, simulate, hold, indexAt, sma, rsi, rollStd } from "../trading/lib/fast.js";
import { MARKETS, allStrategies, searchSpace, build } from "../trading/lib/lab100.js";
import { hillClimb } from "../trading/lib/hillclimb.js";
import { fitLogistic } from "../trading/lib/daytrade.js";

const [DIR, WHAT] = process.argv.slice(2);
if (!DIR || !WHAT) throw new Error("Usage: node scripts/lab100.mjs <data folder> <market|merge>");
const OUT = `${DIR}/out`;
mkdirSync(OUT, { recursive: true });
const ms = (d) => Date.parse(d + "T00:00:00Z");
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const SPLITS = {
  c5: ["2022-11-01", "2024-11-01", "2025-11-01", "2026-11-01"],
  c1h: ["2022-11-01", "2024-11-01", "2025-11-01", "2026-11-01"],
  e1h: ["2024-11-07", "2025-11-01", "2026-05-01", "2026-11-07"],
  ed: ["2020-01-01", "2024-11-01", "2025-11-01", "2026-11-07"],
  cd: ["2020-01-01", "2024-11-01", "2025-11-01", "2026-11-07"],
};
const ETFS = ["SPUS", "HLAL", "UMMA", "SPTE", "SPWO", "SPRE"];
const STOCKS = ["AAPL", "MSFT", "NVDA", "ADBE", "ASML", "TSM"];
const COINS5 = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const COINS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD", "LTC-USD", "LINK-USD", "AVAX-USD", "DOT-USD", "BCH-USD"];

if (WHAT === "merge") merge(); else runMarket(WHAT);

/* ---------- data loading ---------- */

function loadBinance(sym) {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (const f of readdirSync(`${DIR}/binance`).filter((f) => f.startsWith(`${sym}-5m-`) && f.endsWith(".csv")).sort()) {
    for (const line of readFileSync(`${DIR}/binance/${f}`, "utf8").split("\n")) {
      if (!line || line.charCodeAt(0) > 57) continue;
      const p = line.split(",");
      let ts = Number(p[0]);
      if (ts > 1e14) ts /= 1000; // newer files use microseconds
      t.push(ts); o.push(+p[1]); h.push(+p[2]); l.push(+p[3]); c.push(+p[4]); v.push(+p[5]);
    }
  }
  return makeBars({ t, o, h, l, c, v });
}

function loadYahoo(path, { daily = false } = {}) {
  const r = JSON.parse(readFileSync(path, "utf8")).chart.result[0];
  const q = r.indicators.quote[0];
  const off = (r.meta.gmtoffset || 0) * 1000;
  const t = [], o = [], h = [], l = [], c = [], v = [];
  r.timestamp.forEach((ts, i) => {
    if (q.close[i] == null || q.open[i] == null || !(q.close[i] > 0)) return;
    let tt = ts * 1000 + off;
    if (daily) tt = Math.floor(tt / 864e5) * 864e5;
    if (t.length && tt <= t[t.length - 1]) return;
    t.push(tt); o.push(q.open[i]); h.push(Math.max(q.high[i], q.open[i], q.close[i])); l.push(Math.min(q.low[i], q.open[i], q.close[i])); c.push(q.close[i]); v.push(q.volume[i] || 0);
  });
  return makeBars({ t, o, h, l, c, v });
}

// A daily series aligned to a bar set: the latest value on or before each bar's
// date (lag = 1 uses strictly earlier days).
function align(bars, days, vals, lag = 0) {
  const out = new Float64Array(bars.n).fill(NaN);
  let j = 0;
  for (let i = 0; i < bars.n; i++) {
    const d = bars.day[i] - lag;
    while (j < days.length && days[j] <= d) j++;
    if (j > 0) out[i] = vals[j - 1];
  }
  return out;
}

function extras(assets, kind) {
  const macro = (n) => { const b = loadYahoo(`${DIR}/macro/${n}.json`, { daily: true }); return [Array.from(b.day), Array.from(b.c)]; };
  const src = { vix: macro("VIX"), vix3m: macro("VIX3M"), tnx: macro("TNX"), dxy: macro("DX-Y.NYB"), hyg: macro("HYG"), gld: macro("GLD") };
  // News tone (GDELT), lagged a day so a full day's news is known.
  const tone = [];
  for (const f of readdirSync(`${DIR}/macro`).filter((f) => f.startsWith("gdelt-")).sort()) {
    try {
      for (const p of JSON.parse(readFileSync(`${DIR}/macro/${f}`, "utf8")).timeline[0].data) tone.push([Math.floor(Date.parse(p.date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z")) / 864e5), p.value]);
    } catch (_) { /* a year that failed to download is simply missing */ }
  }
  tone.sort((a, b) => a[0] - b[0]);
  // Crypto Fear & Greed.
  const fng = JSON.parse(readFileSync(`${DIR}/macro/feargreed.json`, "utf8")).data.map((d) => [Math.floor(Number(d.timestamp) / 86400), Number(d.value)]).sort((a, b) => a[0] - b[0]);
  // Breadth: share of the halal ETFs and stocks above their own 50-day average.
  const members = [...ETFS, ...STOCKS].map((s) => { const b = loadYahoo(`${DIR}/daily/${s}.json`, { daily: true }); const m = sma(b.c, 50); return { b, m }; });
  const allDays = [...new Set(members.flatMap((x) => Array.from(x.b.day)))].sort((a, b) => a - b);
  const pos = members.map(() => 0);
  const breadth = allDays.map((d) => {
    let up = 0, n = 0;
    members.forEach((x, k) => { while (pos[k] < x.b.n - 1 && x.b.day[pos[k] + 1] <= d) pos[k]++; const i = pos[k]; if (x.b.day[i] <= d && x.m[i] === x.m[i]) { n++; if (x.b.c[i] > x.m[i]) up++; } });
    return n >= 4 ? up / n : NaN;
  });
  const btc = kind === "cd" ? loadYahoo(`${DIR}/daily/BTC-USD.json`, { daily: true }) : null;
  for (const a of assets) {
    const x = {};
    for (const [k, [d, v]] of Object.entries(src)) x[k] = align(a.bars, d, v);
    x.tone = align(a.bars, tone.map((p) => p[0]), tone.map((p) => p[1]), 1);
    x.fng = align(a.bars, fng.map((p) => p[0]), fng.map((p) => p[1]));
    x.breadth = align(a.bars, allDays, breadth);
    if (btc) x.btc = align(a.bars, Array.from(btc.day), Array.from(btc.c));
    a.bars.x = x;
  }
  return { toneDays: tone.length };
}

// Walk-forward probability model on daily bars, pooled across the market's
// assets and refit each month on the previous 3 years. A row is only used for
// training once its outcome (the next h days) is fully in the past.
function addModels(assets, kind, cost) {
  const z = (v) => (v === v && Number.isFinite(v) ? v : 0);
  for (const a of assets) {
    const b = a.bars, x = b.x;
    const s20 = sma(b.c, 20), s100 = sma(b.c, 100), r2 = rsi(b.c, 2);
    const ret = Float64Array.from(b.c, (c, i) => (i ? c / b.c[i - 1] - 1 : 0));
    const v20 = rollStd(ret, 20);
    const xs = (name, n) => sma(x[name], n);
    const vix20 = xs("vix", 20), hyg50 = xs("hyg", 50), dxy50 = xs("dxy", 50), tone50 = xs("tone", 50), toneSd = rollStd(Float64Array.from(x.tone, z), 50), fng30 = xs("fng", 30);
    const btc50 = x.btc ? sma(x.btc, 50) : null;
    a.price = []; a.alt = [];
    for (let i = 0; i < b.n; i++) {
      const p = i >= 100 ? [ret[i], b.c[i] / b.c[i - 5] - 1, r2[i] / 100 - 0.5, b.c[i] / s20[i] - 1, v20[i], (b.h[i] - b.l[i]) / b.c[i], b.c[i] > s100[i] ? 1 : 0] : null;
      a.price.push(p && p.every((v) => v === v) ? p : null);
      if (!a.price[i]) { a.alt.push(null); continue; }
      const extra = kind === "ed"
        ? [z(x.vix[i] / 20 - 1), z(x.vix[i] / vix20[i] - 1), z(x.vix[i] / x.vix3m[i] - 1), z(x.hyg[i] / hyg50[i] - 1), z(x.dxy[i] / dxy50[i] - 1), z(i >= 20 ? x.tnx[i] - x.tnx[i - 20] : 0), z(x.breadth[i] - 0.5), z((x.tone[i] - tone50[i]) / (toneSd[i] || NaN))]
        : [z(x.fng[i] / 100 - 0.5), z((x.fng[i] - fng30[i]) / 100), z(x.btc[i] / btc50[i] - 1), z(x.dxy[i] / dxy50[i] - 1), z(x.vix[i] / vix20[i] - 1)];
      a.alt.push([...a.price[i], ...extra]);
    }
    b.x.model = {};
  }
  const months = [...new Set(assets.flatMap((a) => Array.from(a.bars.t, (t) => iso(t).slice(0, 7))))].sort();
  for (const h of [1, 3, 5, 10]) {
    for (const which of ["price", "alt"]) {
      for (const a of assets) a.bars.x.model[which + h] = new Float64Array(a.bars.n).fill(NaN);
      for (const month of months) {
        const start = ms(month + "-01");
        const X = [], y = [];
        for (const a of assets) {
          const b = a.bars;
          for (let i = 0; i + 1 + h < b.n && b.t[i + 1 + h] < start; i++) {
            if (b.t[i] < start - 3 * 365 * 864e5 || !a[which][i]) continue;
            X.push(a[which][i]);
            y.push(b.o[i + 1 + h] / b.o[i + 1] - 1 > 2 * cost ? 1 : 0);
          }
        }
        if (X.length < 300) continue;
        const model = fitLogistic(X, y, { lambda: 5 });
        for (const a of assets) {
          const b = a.bars;
          for (let i = indexAt(b, start); i < b.n && iso(b.t[i]).slice(0, 7) === month; i++) if (a[which][i]) b.x.model[which + h][i] = model.predict(a[which][i]);
        }
      }
    }
  }
}

function loadMarket(mk) {
  let assets;
  if (mk === "c5") assets = COINS5.map((s) => ({ sym: s.replace("USDT", ""), bars: loadBinance(s) }));
  else if (mk === "c1h") assets = COINS5.map((s) => ({ sym: s.replace("USDT", ""), bars: aggregate(loadBinance(s), 36e5) }));
  else if (mk === "e1h") assets = ETFS.map((s) => ({ sym: s, bars: loadYahoo(`${DIR}/hourly/${s}.json`) }));
  else if (mk === "ed") assets = ETFS.map((s) => ({ sym: s, bars: loadYahoo(`${DIR}/daily/${s}.json`, { daily: true }) }));
  else assets = COINS.map((s) => ({ sym: s.replace("-USD", ""), bars: loadYahoo(`${DIR}/daily/${s}.json`, { daily: true }) }));
  let info = {};
  if (mk === "ed" || mk === "cd") { info = extras(assets, mk); addModels(assets, mk, MARKETS[mk].cost); }
  return { assets, info };
}

/* ---------- tuning and scoring ---------- */

function runMarket(mk) {
  const M = MARKETS[mk];
  const [t0, t1, t2, t3] = SPLITS[mk].map(ms);
  const { assets, info } = loadMarket(mk);
  for (const a of assets) a.ix = [t0, t1, t2, t3].map((t) => indexAt(a.bars, t));
  const minBars = mk === "ed" || mk === "cd" ? 60 : 300;
  const has = (a, k) => a.ix[k + 1] - a.ix[k] >= minBars;
  console.log(mk, assets.map((a) => `${a.sym}:${a.bars.n}`).join(" "), JSON.stringify(info));

  // Mean result across the market's assets over one period.
  const period = (s, p, k, { costMult = 1, curve = false, from = null } = {}) => {
    let ret = 0, trades = 0, wins = 0, n = 0, expo = 0, holdRet = 0;
    const curves = [];
    for (const a of assets) {
      if (!has(a, k)) continue;
      const { enter, exit, opts } = build(s, a.bars, p);
      const range = { from: from ?? a.ix[k], to: a.ix[k + 1] };
      const r = simulate(a.bars, enter, exit, { ...opts, cost: opts.cost * costMult, ...range, curve });
      const hd = hold(a.bars, { cost: M.cost, ...range, curve });
      ret += r.ret; trades += r.trades; wins += r.wins; expo += r.exposure; holdRet += hd.ret; n++;
      if (curve) curves.push({ r, hd });
    }
    if (!n) return null;
    return { ret: ret / n, trades, wins, exposure: expo / n, hold: holdRet / n, assets: n, curves };
  };
  const yearly = (ret, k, k2 = k + 1) => Math.pow(1 + ret, (365.25 * 864e5) / ([t0, t1, t2, t3][k2] - [t0, t1, t2, t3][k])) - 1;

  const rows = [];
  for (const s of allStrategies().filter((x) => x.market === mk)) {
    const started = Date.now();
    const { space, start } = searchSpace(s);
    const climb = hillClimb({
      space, start, restarts: 8, seed: 5, maxSteps: 60,
      // Log of growth: the same goal as return, but still tells apart settings that lose nearly everything.
      score: (p) => { const r = period(s, p, 0); return !r ? -99 : r.trades < 10 ? -50 + r.trades / 1000 : Math.log(Math.max(1 + r.ret, 1e-12)); },
    });
    const p = climb.best.params;
    const [tune, val, test] = [0, 1, 2].map((k) => period(s, p, k));
    const test2x = period(s, p, 2, { costMult: 2 });
    const def = period(s, start, 2);
    // Equity over validation + test (one continuous run), averaged across assets by day.
    const cont = (() => {
      let acc = null;
      for (const a of assets) {
        if (!has(a, 1) || !has(a, 2)) continue;
        const { enter, exit, opts } = build(s, a.bars, p);
        const r = simulate(a.bars, enter, exit, { ...opts, from: a.ix[1], to: a.ix[3], curve: true });
        const hd = hold(a.bars, { cost: M.cost, from: a.ix[1], to: a.ix[3], curve: true });
        const m = new Map(r.days.map((d, i) => [d, r.vals[i]]));
        const mh = new Map(hd.days.map((d, i) => [d, hd.vals[i]]));
        if (!acc) acc = { days: r.days.slice(), s: [], h: [], n: 0 };
        let ls = 1, lh = 1;
        acc.days.forEach((d, i) => { if (m.has(d)) ls = m.get(d); if (mh.has(d)) lh = mh.get(d); acc.s[i] = (acc.s[i] || 0) + ls; acc.h[i] = (acc.h[i] || 0) + lh; });
        acc.n++;
      }
      if (!acc) return null;
      const step = Math.max(1, Math.ceil(acc.days.length / 180));
      const pick = (arr) => arr.filter((_, i) => i % step === 0 || i === arr.length - 1).map((v) => Math.round((v / acc.n) * 1e4) / 1e4);
      const eq = acc.s.map((v) => v / acc.n);
      let peak = 0, mdd = 0, mddTest = 0, peakT = 0;
      eq.forEach((v, i) => { if (v > peak) peak = v; if (v / peak - 1 < mdd) mdd = v / peak - 1; if (acc.days[i] * 864e5 >= t2) { if (v > peakT) peakT = v; if (v / peakT - 1 < mddTest) mddTest = v / peakT - 1; } });
      return { days: acc.days.filter((_, i) => i % step === 0 || i === acc.days.length - 1), strat: pick(acc.s), hold: pick(acc.h), mdd, mddTest };
    })();
    const pack = (r, k) => r && { ret: r.ret, yearly: yearly(r.ret, k), trades: r.trades, winRate: r.trades ? r.wins / r.trades : null, exposure: r.exposure, hold: r.hold, holdYearly: yearly(r.hold, k) };
    rows.push({
      key: s.key, market: mk, rule: s.rule.id, name: s.rule.name, group: s.group, idea: s.rule.idea, data: s.rule.data || "Prices and volume",
      tuned: p, evaluations: climb.evaluations,
      tune: pack(tune, 0), val: pack(val, 1), test: pack(test, 2),
      testDoubleCost: test2x && test2x.ret, testDefault: def && def.ret, testDrop: cont && cont.mddTest, curve: cont && { days: cont.days, strat: cont.strat, hold: cont.hold },
    });
    const f = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
    console.log(`${s.key.padEnd(16)} ${climb.evaluations} tries ${((Date.now() - started) / 1000).toFixed(0)}s | tune ${f(tune?.ret)} (hold ${f(tune?.hold)}, ${tune?.trades} tr) | val ${f(val?.ret)} (hold ${f(val?.hold)}) | test ${f(test?.ret)} (hold ${f(test?.hold)}, ${test?.trades} tr) 2x cost ${f(test2x?.ret)} | ${JSON.stringify(p)}`);
  }
  writeFileSync(`${OUT}/${mk}.json`, JSON.stringify({ market: mk, label: M.label, bar: M.bar, cost: M.cost, splits: SPLITS[mk], assets: assets.map((a) => a.sym), info, rows }));
}

function merge() {
  const markets = {};
  let rows = [];
  for (const mk of Object.keys(MARKETS)) {
    if (!existsSync(`${OUT}/${mk}.json`)) throw new Error(`Missing results for ${mk}`);
    const j = JSON.parse(readFileSync(`${OUT}/${mk}.json`, "utf8"));
    markets[mk] = { label: j.label, bar: j.bar, cost: j.cost, splits: j.splits, assets: j.assets };
    rows = rows.concat(j.rows);
  }
  writeFileSync(new URL("../trading/data/lab100.json", import.meta.url), JSON.stringify({ generated: new Date().toISOString(), markets, rows }));
  console.log(rows.length, "strategies written");
}
