// Fragility check for the tuned settings in trading/data/hillclimb.json:
// move each setting one step either way and re-run the test years. Settings
// whose neighbours collapse were probably a lucky spike, not a real edge.
// Usage: node scripts/robustness.mjs   (run after scripts/hillclimb.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { runBacktest } from "../trading/lib/engine.js";
import { summarize } from "../trading/lib/stats.js";
import { walkForward } from "../trading/lib/daytrade.js";
import { family, setup } from "../trading/lib/catalog.js";
import { riskAdjusted } from "../trading/lib/hillclimb.js";

const path = new URL("../trading/data/hillclimb.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf8"));
const load = (s) => JSON.parse(readFileSync(new URL(`../trading/data/${s}.json`, import.meta.url)));
const cache = {};
for (const r of data.results) {
  const F = family(r.family);
  const space = { ...F.space, ...(F.spaceFor?.[r.universe] || {}) };
  for (const s of [...r.symbols, r.benchmark, "SPSK"]) cache[s] ||= load(s);
  const wfc = new Map();
  const test = (p) => {
    let wf = null;
    if (F.needsModel) {
      const k = [p.maxHold, p.stopPct, p.exitLen].join("|");
      if (!wfc.has(k)) wfc.set(k, walkForward(cache, r.symbols, { start: data.tune[0], end: data.test[1], maxHold: p.maxHold, stopPct: p.stopPct, exitLen: p.exitLen, costBps: r.costBps }));
      wf = wfc.get(k);
    }
    const x = setup(F, p, r.symbols, r.benchmark, wf);
    const res = runBacktest({ series: cache, symbols: x.symbols, strategy: x.strategy, params: x.params, capital: 10000, slippageBps: r.costBps, startDate: data.test[0], endDate: data.test[1], benchmark: r.benchmark });
    const s = summarize(res);
    return { cagr: s.cagr, score: riskAdjusted({ ...s, trades: res.trades.length }, { minTrades: 0 }) };
  };
  const hold = r.test.bench.cagr / Math.max(Math.abs(r.test.bench.maxDrawdown), 0.1);
  const out = [];
  for (const k of Object.keys(space)) {
    const i = space[k].indexOf(r.tuned[k]);
    for (const j of [i - 1, i + 1]) if (i >= 0 && j >= 0 && j < space[k].length) out.push(test({ ...r.tuned, [k]: space[k][j] }));
  }
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const scores = sorted(out.map((x) => x.score));
  const cagrs = sorted(out.map((x) => x.cagr));
  r.neighbours = out.length
    ? { n: out.length, beatHold: scores.filter((x) => x > hold).length, medianScore: scores[Math.floor(scores.length / 2)], worstScore: scores[0], medianCagr: cagrs[Math.floor(cagrs.length / 2)], worstCagr: cagrs[0] }
    : null;
  console.log(`${r.universe.padEnd(6)} ${r.name.padEnd(26)} neighbours ${r.neighbours ? `${r.neighbours.beatHold}/${r.neighbours.n} beat holding, median ${(r.neighbours.medianCagr * 100).toFixed(1)}%` : "—"}`);
}
writeFileSync(path, JSON.stringify(data, null, 1));
