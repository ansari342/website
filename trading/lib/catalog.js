// Every strategy family the tuner searches, with its starting settings and
// the values hill climbing may try. Shared by scripts/hillclimb.mjs and the
// Tuning tab so both build each strategy the same way.

import { probabilityStrategy, filteredDipStrategy } from "./daytrade.js";
import { dipBuyer, trendGuard } from "./strategies.js";
import { breakout, goldenCross, volTarget, calmLeaders, weeklyReversal, bandBounce, momentumDips, coreDips, dualMomentum, calmDips } from "./strategies2.js";

const fromFields = (s) => Object.fromEntries(s.fields.map((f) => [f.key, f.default]));

export const FAMILIES = [
  // ---- The original four ----
  {
    id: "prob",
    name: "Probability trader",
    kind: "original",
    needsModel: true,
    build: (p, wf) => probabilityStrategy(wf, p),
    start: { threshold: 0.75, maxPositions: 10, size: 0.1, maxHold: 10, stopPct: 0.1, exitLen: 5 },
    space: {
      threshold: [0.55, 0.6, 0.625, 0.65, 0.675, 0.7, 0.725, 0.75, 0.775, 0.8, 0.85],
      maxPositions: [1, 2, 3, 4, 5, 6, 8, 10],
      size: [0.1, 0.15, 0.2, 0.25, 0.33, 0.5],
      maxHold: [3, 5, 7, 10, 15, 20],
      stopPct: [0.05, 0.075, 0.1, 0.15, 0.2],
      exitLen: [3, 5, 7, 10],
    },
  },
  {
    id: "dipmodel",
    name: "Dip Buyer + model filter",
    kind: "original",
    needsModel: true,
    build: (p, wf) => filteredDipStrategy(wf, p),
    start: { threshold: 0.6, entryRsi: 15, maxPositions: 3, size: 0.33, maxHold: 10, stopPct: 0.1, exitLen: 5 },
    space: {
      threshold: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75],
      entryRsi: [5, 10, 15, 20, 25, 30],
      maxPositions: [1, 2, 3, 4, 5, 6],
      size: [0.15, 0.2, 0.25, 0.33, 0.5],
      maxHold: [3, 5, 7, 10, 15],
      stopPct: [0.05, 0.075, 0.1, 0.15, 0.2],
      exitLen: [3, 5, 7, 10],
    },
  },
  {
    id: "dip",
    name: "Dip Buyer",
    kind: "original",
    strategy: dipBuyer,
    start: { entryRsi: 15, trendLen: 200, exitLen: 5, maxHold: 10, stopPct: 10, maxPositions: 2 },
    space: { entryRsi: [5, 10, 15, 20, 25, 30], trendLen: [100, 150, 200, 250], exitLen: [3, 5, 7, 10], maxHold: [3, 5, 7, 10, 15], stopPct: [5, 7.5, 10, 15, 20], maxPositions: [1, 2, 3, 4, 5, 6] },
  },
  {
    id: "guard",
    name: "Trend Guard",
    kind: "original",
    strategy: trendGuard,
    single: true,
    minTrades: 2,
    start: { trendLen: 200, band: 2, useDefensive: 0 },
    space: { trendLen: [50, 75, 100, 125, 150, 175, 200, 250], band: [0, 1, 2, 3, 5], useDefensive: [0] },
  },
  // ---- Five new ideas ----
  {
    id: "breakout",
    name: "Breakout",
    kind: "new",
    strategy: breakout,
    start: fromFields(breakout),
    space: { entryLen: [10, 20, 30, 40, 55, 75, 100, 150], exitLen: [5, 10, 15, 20, 30, 40], stopPct: [5, 7.5, 10, 15, 20, 30], maxPositions: [1, 2, 3, 4, 5, 6] },
  },
  {
    id: "golden",
    name: "Golden Cross",
    kind: "new",
    strategy: goldenCross,
    minTrades: 6,
    start: fromFields(goldenCross),
    space: { fast: [10, 20, 30, 50, 75, 100], slow: [50, 100, 150, 200, 250, 300], maxPositions: [1, 2, 3, 4, 5, 6] },
  },
  {
    id: "voltarget",
    name: "Volatility Target",
    kind: "new",
    strategy: volTarget,
    single: true,
    minTrades: 4,
    start: fromFields(volTarget),
    space: { targetVol: [5, 10, 15, 20, 25, 30, 40, 50, 60], volLen: [10, 20, 40, 60, 120], buffer: [10, 20, 30, 50], trendLen: [0, 100, 150, 200] },
  },
  {
    id: "lowvol",
    name: "Calm Leaders",
    kind: "new",
    strategy: calmLeaders,
    minTrades: 6,
    start: fromFields(calmLeaders),
    space: { volLen: [20, 40, 60, 120, 250], trendLen: [50, 100, 150, 200, 250], top: [1, 2, 3, 4, 5] },
  },
  {
    id: "reversal",
    name: "Weekly Reversal",
    kind: "new",
    strategy: weeklyReversal,
    start: fromFields(weeklyReversal),
    space: { lookback: [2, 3, 5, 10, 15, 20], trendLen: [50, 100, 150, 200, 250], top: [1, 2, 3, 4, 5], stopPct: [5, 7.5, 10, 15, 20, 30] },
  },
  // ---- Five variations and combinations ----
  {
    id: "bands",
    name: "Band Bounce",
    kind: "permutation",
    strategy: bandBounce,
    start: fromFields(bandBounce),
    space: { len: [10, 15, 20, 30, 40], k: [1, 1.5, 2, 2.5, 3], trendLen: [100, 150, 200, 250], maxHold: [5, 10, 15, 20, 30], stopPct: [5, 7.5, 10, 15, 20], maxPositions: [1, 2, 3, 4, 5, 6] },
  },
  {
    id: "momdip",
    name: "Momentum Dips",
    kind: "permutation",
    strategy: momentumDips,
    start: fromFields(momentumDips),
    space: { lookback: [21, 63, 126, 189, 252], topK: [1, 2, 3, 4, 5, 6], entryRsi: [5, 10, 15, 20, 25, 30], trendLen: [100, 150, 200, 250], exitLen: [3, 5, 7, 10], maxHold: [3, 5, 7, 10, 15], stopPct: [5, 7.5, 10, 15, 20], maxPositions: [1, 2, 3, 4] },
  },
  {
    id: "coredip",
    name: "Core + Dips",
    kind: "permutation",
    strategy: coreDips,
    start: fromFields(coreDips),
    space: { coreWeight: [0, 20, 40, 50, 60, 70, 80, 90], coreTrend: [100, 150, 200, 250], band: [0, 1, 2, 3], entryRsi: [5, 10, 15, 20, 25], trendLen: [100, 150, 200, 250], exitLen: [3, 5, 7, 10], maxHold: [5, 7, 10, 15], stopPct: [5, 10, 15, 20], maxPositions: [1, 2, 3, 4] },
  },
  {
    id: "dualmom",
    name: "Dual Momentum",
    kind: "permutation",
    strategy: dualMomentum,
    minTrades: 6,
    start: fromFields(dualMomentum),
    space: { lookback: [21, 42, 63, 126, 189, 252], top: [1, 2, 3, 4], useDefensive: [0, 1] },
    spaceFor: { crypto: { useDefensive: [0] } },
    startFor: { crypto: { useDefensive: 0 } },
  },
  {
    id: "voldip",
    name: "Calm-Sized Dips",
    kind: "permutation",
    strategy: calmDips,
    start: fromFields(calmDips),
    space: { targetVol: [5, 10, 15, 20, 30, 40, 60, 80], entryRsi: [5, 10, 15, 20, 25, 30], trendLen: [100, 150, 200, 250], exitLen: [3, 5, 7, 10], maxHold: [3, 5, 7, 10, 15], stopPct: [5, 7.5, 10, 15, 20], maxPositions: [1, 2, 3, 4, 5] },
  },
];

export const family = (id) => FAMILIES.find((f) => f.id === id);

// Build the strategy and the symbols it trades for one family and universe.
// `wf` is the model's walk-forward output (only needed by model families).
export function setup(fam, params, symbols, core, wf = null) {
  if (fam.needsModel) return { strategy: fam.build(params, wf), params: {}, symbols };
  return { strategy: fam.strategy, params, symbols: fam.single ? [core] : symbols };
}
