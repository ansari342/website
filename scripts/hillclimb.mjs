// Hill-climb the lab's strategies on the first 3 years of the last 5, then
// score the chosen settings on the last 2 years, which the search never saw.
// Writes trading/data/hillclimb.json for the Quick trades tab.
// Usage: node scripts/hillclimb.mjs [family ids, comma-separated, to run only those]
const ONLY = process.argv[2] ? process.argv[2].split(",") : null;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { runBacktest } from "../trading/lib/engine.js";
import { summarize, summarizeSeries, bootstrapYears } from "../trading/lib/stats.js";
import { walkForward } from "../trading/lib/daytrade.js";
import { FAMILIES, setup } from "../trading/lib/catalog.js";
import { hillClimb, riskAdjusted } from "../trading/lib/hillclimb.js";

const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));
const UNIVERSES = {
  etfs: { label: "Halal ETFs only (no stock picking)", symbols: ["SPUS", "HLAL", "UMMA", "SPTE", "SPWO", "SPRE"], bench: "SPUS", cost: 5, core: "SPUS" },
  stocks: { label: "Halal stocks and funds", symbols: ["SPUS", "HLAL", "UMMA", "SPTE", "AAPL", "MSFT", "NVDA", "ADBE", "ASML", "TSM"], bench: "SPUS", cost: 5, core: "SPUS" },
  crypto: { label: "Crypto (spot only)", symbols: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD", "LTC-USD", "LINK-USD", "AVAX-USD", "DOT-USD", "BCH-USD"], bench: "BTC-USD", cost: 10, core: "BTC-USD" },
};
const START = "2021-11-05";
const SPLIT = "2024-09-01"; // tune before, test after
const END = "2026-11-05";
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

const results = [];
for (const [uid, U] of Object.entries(UNIVERSES)) {
  const series = Object.fromEntries([...new Set([...U.symbols, U.bench, "SPSK"])].map((s) => [s, load(s)]));
  const wfCache = new Map();
  const wfFor = (p, costBps) => {
    const key = [p.maxHold, p.stopPct, p.exitLen, costBps].join("|");
    if (!wfCache.has(key)) wfCache.set(key, walkForward(series, U.symbols, { start: START, end: END, maxHold: p.maxHold, stopPct: p.stopPct, exitLen: p.exitLen, costBps }));
    return wfCache.get(key);
  };
  const backtest = (strategy, symbols, from, to, costBps, params = {}) =>
    runBacktest({ series, symbols, strategy, params, capital: 10000, slippageBps: costBps, startDate: from, endDate: to, benchmark: U.bench });

  const families = FAMILIES.filter((F) => !ONLY || ONLY.includes(F.id)).map((F) => ({
    ...F,
    start: { ...F.start, ...(F.startFor?.[uid] || {}) },
    space: { ...F.space, ...(F.spaceFor?.[uid] || {}) },
    run: (p, from, to, cost) => {
      const wf = F.needsModel ? wfFor(p, U.cost) : null;
      const x = setup(F, p, U.symbols, U.core, wf);
      return backtest(x.strategy, x.symbols, from, to, cost, x.params);
    },
  }));

  for (const F of families) {
    const t0 = Date.now();
    const minTrades = F.minTrades ?? 20;
    const climb = hillClimb({
      space: F.space,
      start: F.start,
      restarts: 3,
      seed: 11,
      score: (p) => {
        const r = F.run(p, START, SPLIT, U.cost);
        return riskAdjusted({ ...summarize(r), trades: r.trades.length }, { minTrades });
      },
    });
    const evalSet = (p, from, to, cost = U.cost) => {
      const r = F.run(p, from, to, cost);
      const s = summarize(r);
      const b = summarizeSeries(r.benchmark, r.dates, r.capital);
      const odds = bootstrapYears(r.equity);
      return {
        cagr: s.cagr,
        maxDrawdown: s.maxDrawdown,
        sharpe: s.sharpe,
        trades: r.trades.length,
        winRate: s.winRate,
        avgTrade: s.expectancy,
        exposure: s.exposure,
        score: riskAdjusted({ ...s, trades: r.trades.length }, { minTrades: 0 }),
        pYearUp: odds ? odds.pGain : null,
        bench: { cagr: b.cagr, maxDrawdown: b.maxDrawdown, sharpe: b.sharpe },
      };
    };
    const tuned = climb.best.params;
    const row = {
      universe: uid,
      universeLabel: U.label,
      symbols: U.symbols,
      benchmark: U.bench,
      costBps: U.cost,
      family: F.id,
      name: F.name,
      kind: F.kind,
      start: F.start,
      tuned,
      evaluations: climb.evaluations,
      climbPath: climb.paths.find((p) => p.at(-1).params === tuned)?.map((x) => ({ params: x.params, score: x.score })) || [],
      defaultTrain: evalSet(F.start, START, SPLIT),
      defaultTest: evalSet(F.start, SPLIT, END),
      train: evalSet(tuned, START, SPLIT),
      test: evalSet(tuned, SPLIT, END),
      testHighCost: evalSet(tuned, SPLIT, END, U.cost * 2.5),
    };
    results.push(row);
    console.log(
      `${uid.padEnd(6)} ${F.name.padEnd(26)} ${climb.evaluations} tries ${((Date.now() - t0) / 1000).toFixed(0)}s | ` +
        `TRAIN default ${pct(row.defaultTrain.cagr)}/${pct(row.defaultTrain.maxDrawdown)} → tuned ${pct(row.train.cagr)}/${pct(row.train.maxDrawdown)} (${row.train.trades} trades) | ` +
        `TEST default ${pct(row.defaultTest.cagr)}/${pct(row.defaultTest.maxDrawdown)} tuned ${pct(row.test.cagr)}/${pct(row.test.maxDrawdown)} (${row.test.trades} tr, win ${pct(row.test.winRate)}) | hold ${pct(row.test.bench.cagr)}/${pct(row.test.bench.maxDrawdown)} | 2.5x cost ${pct(row.testHighCost.cagr)} | ${JSON.stringify(tuned)}`
    );
  }
}
const outPath = new URL("../trading/data/hillclimb.json", import.meta.url);
let merged = results;
if (ONLY && existsSync(outPath)) {
  // Keep earlier results for the families that weren't re-run.
  const old = JSON.parse(readFileSync(outPath, "utf8")).results || [];
  const key = (r) => `${r.universe}|${r.family}`;
  const fresh = new Set(results.map(key));
  merged = [...old.filter((r) => !fresh.has(key(r))), ...results];
}
const order = FAMILIES.map((f) => f.id);
merged.sort((a, b) => a.universe.localeCompare(b.universe) || order.indexOf(a.family) - order.indexOf(b.family));
writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), tune: [START, SPLIT], test: [SPLIT, END], objective: "yearly return ÷ worst drop (drops under 10% count as 10%), at least 20 trades", results: merged }, null, 1));
