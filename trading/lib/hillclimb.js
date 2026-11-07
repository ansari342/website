// Hill climbing over a grid of settings.
//
// From a starting point, try moving each setting one step up or down; take
// the move that improves the score most, and repeat until nothing improves.
// A few random restarts reduce the chance of getting stuck on a small hill.
// Scores are cached, so revisiting a point is free.

import { mulberry32 } from "./stats.js";

// space: { key: [allowed values in order] }
export function hillClimb({ space, start, score, restarts = 3, seed = 1, maxSteps = 60 }) {
  const keys = Object.keys(space);
  const rand = mulberry32(seed);
  const cache = new Map();
  const id = (p) => keys.map((k) => p[k]).join("|");
  const evalAt = (p) => {
    const k = id(p);
    if (!cache.has(k)) cache.set(k, score(p));
    return cache.get(k);
  };
  const snap = (p) => Object.fromEntries(keys.map((k) => [k, space[k].includes(p[k]) ? p[k] : space[k][Math.floor(space[k].length / 2)]]));
  const starts = [snap(start)];
  for (let r = 0; r < restarts; r++) starts.push(Object.fromEntries(keys.map((k) => [k, space[k][Math.floor(rand() * space[k].length)]])));

  let best = null;
  const paths = [];
  for (const s0 of starts) {
    let cur = s0;
    let curScore = evalAt(cur);
    const path = [{ params: cur, score: curScore }];
    for (let step = 0; step < maxSteps; step++) {
      let move = null;
      for (const k of keys) {
        const i = space[k].indexOf(cur[k]);
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= space[k].length) continue;
          const next = { ...cur, [k]: space[k][j] };
          const sc = evalAt(next);
          if (sc > curScore + 1e-12 && (!move || sc > move.score)) move = { params: next, score: sc };
        }
      }
      if (!move) break;
      cur = move.params;
      curScore = move.score;
      path.push(move);
    }
    paths.push(path);
    if (!best || curScore > best.score) best = { params: cur, score: curScore };
  }
  return { best, paths, evaluations: cache.size };
}

// The search target: yearly return divided by the worst drop, with drops
// smaller than `floor` counted as `floor`, so barely-trading settings with a
// tiny drop don't win. Needs at least `minTrades` trades to count at all.
export function riskAdjusted(stats, { floor = 0.1, minTrades = 20 } = {}) {
  if ((stats.trades ?? minTrades) < minTrades) return -10 + (stats.trades || 0) / minTrades;
  return stats.cagr / Math.max(Math.abs(stats.maxDrawdown), floor);
}
