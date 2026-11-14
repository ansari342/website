// A fast single-asset bar backtester for the 100-strategy lab. It works on any
// bar size (5-minute, hourly, daily) using typed arrays, so hundreds of
// thousands of bars can be re-run thousands of times.
//
// Rules, same spirit as the daily engine:
// - A strategy only sees a bar after it closes; its orders fill at the NEXT
//   bar's open. No look-ahead.
// - Long or flat only: fully invested in the asset, or in cash. No shorting,
//   no borrowing.
// - Every fill pays the trading cost. Stops that gap through fill at the open.
//   If a stop and a target could both hit in one bar, the stop is assumed first.

/* ---------- indicators (NaN until enough history) ---------- */

const cacheOf = new WeakMap();
// Cache indicator arrays per bar set, since hill climbing re-asks for the same ones.
export function memo(bars, key, make) {
  let m = cacheOf.get(bars);
  if (!m) cacheOf.set(bars, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

export function sma(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  let s = 0;
  let bad = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) bad = n; else s += v;
    if (i >= n) { const u = a[i - n]; if (u === u) s -= u; }
    if (bad > 0) bad--;
    if (i >= n - 1 && bad === 0) out[i] = s / n;
  }
  return out;
}
export function ema(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) continue;
    e = e !== e ? v : e + k * (v - e);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}
export function rollStd(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    s2 += a[i] * a[i];
    if (i >= n) { s -= a[i - n]; s2 -= a[i - n] * a[i - n]; }
    if (i >= n - 1) { const m = s / n; out[i] = Math.sqrt(Math.max(s2 / n - m * m, 0)); }
  }
  return out;
}
function rollExt(a, n, sign) {
  const out = new Float64Array(a.length).fill(NaN);
  const dq = new Int32Array(a.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < a.length; i++) {
    while (tail > head && sign * a[dq[tail - 1]] <= sign * a[i]) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - n) head++;
    if (i >= n - 1) out[i] = a[dq[head]];
  }
  return out;
}
export const rollMax = (a, n) => rollExt(a, n, 1);
export const rollMin = (a, n) => rollExt(a, n, -1);
export function rsi(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  let g = 0;
  let l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    const up = d > 0 ? d : 0;
    const dn = d < 0 ? -d : 0;
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
export function atr(b, n) {
  const tr = new Float64Array(b.n);
  for (let i = 0; i < b.n; i++) tr[i] = i ? Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1])) : b.h[i] - b.l[i];
  return sma(tr, n);
}
export function roc(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  for (let i = n; i < a.length; i++) out[i] = a[i] / a[i - n] - 1;
  return out;
}

/* ---------- bars ---------- */

// Build a bar set. `t` is epoch milliseconds in the market's local clock
// (exchange time for stocks, UTC for crypto), used for day and hour fields.
export function makeBars({ t, o, h, l, c, v }) {
  const n = t.length;
  const b = { n, t: Float64Array.from(t), o: Float64Array.from(o), h: Float64Array.from(h), l: Float64Array.from(l), c: Float64Array.from(c), v: Float64Array.from(v || new Array(n).fill(0)) };
  b.day = new Int32Array(n);
  b.hour = new Uint8Array(n);
  b.dow = new Uint8Array(n);
  b.first = new Uint8Array(n);
  b.last = new Uint8Array(n);
  b.inDay = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    b.day[i] = Math.floor(b.t[i] / 864e5);
    b.hour[i] = Math.floor((b.t[i] % 864e5) / 36e5);
    b.dow[i] = (b.day[i] + 4) % 7; // 1970-01-01 was a Thursday
    b.first[i] = i === 0 || b.day[i] !== b.day[i - 1] ? 1 : 0;
    b.inDay[i] = b.first[i] ? 0 : b.inDay[i - 1] + 1;
    if (i > 0 && b.first[i]) b.last[i - 1] = 1;
  }
  if (n) b.last[n - 1] = 1;
  return b;
}

// Combine bars into bigger ones (for example 12 five-minute bars → 1 hour).
export function aggregate(b, ms) {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  let cur = -1;
  for (let i = 0; i < b.n; i++) {
    const k = Math.floor(b.t[i] / ms);
    if (k !== cur) { cur = k; t.push(k * ms); o.push(b.o[i]); h.push(b.h[i]); l.push(b.l[i]); c.push(b.c[i]); v.push(b.v[i]); }
    else { const j = t.length - 1; if (b.h[i] > h[j]) h[j] = b.h[i]; if (b.l[i] < l[j]) l[j] = b.l[i]; c[j] = b.c[i]; v[j] += b.v[i]; }
  }
  return makeBars({ t, o, h, l, c, v });
}

export const indexAt = (b, ms) => {
  let lo = 0;
  let hi = b.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b.t[mid] < ms) lo = mid + 1; else hi = mid; }
  return lo;
};

/* ---------- simulation ---------- */

// enter/exit: Uint8Array signals evaluated at each bar's close.
// Returns total return over bars [from, to), trade stats and optional daily equity.
export function simulate(b, enter, exit, { cost = 0.0005, stopPct = 0, takePct = 0, maxHold = 0, eod = false, from = 0, to = b.n, curve = false } = {}) {
  const { o, h, l, c, last } = b;
  let eq = 1, inPos = false, entry = 0, held = 0, pendE = false, pendX = false;
  let trades = 0, wins = 0, peak = 1, mdd = 0, barsIn = 0, stop = 0, take = 0;
  const days = curve ? [] : null;
  const vals = curve ? [] : null;
  for (let i = from; i < to; i++) {
    const op = o[i];
    if (pendX && inPos) { const r = (op * (1 - cost)) / entry; eq *= r; trades++; if (r > 1) wins++; inPos = false; }
    if (pendE && !inPos) { inPos = true; entry = op * (1 + cost); held = 0; stop = entry * (1 - stopPct); take = entry * (1 + takePct); }
    pendE = pendX = false;
    if (inPos) {
      let px = 0;
      if (stopPct > 0 && l[i] <= stop) px = op < stop ? op : stop;
      else if (takePct > 0 && h[i] >= take) px = op > take ? op : take;
      if (px > 0) { const r = (px * (1 - cost)) / entry; eq *= r; trades++; if (r > 1) wins++; inPos = false; }
    }
    if (inPos) {
      held++;
      barsIn++;
      if (eod && last[i]) { const r = (c[i] * (1 - cost)) / entry; eq *= r; trades++; if (r > 1) wins++; inPos = false; }
      else if (exit[i] || (maxHold > 0 && held >= maxHold)) pendX = true;
    } else if (enter[i] && !(eod && last[i])) pendE = true;
    const mark = inPos ? (eq * c[i] * (1 - cost)) / entry : eq;
    if (mark > peak) peak = mark; else if (mark / peak - 1 < mdd) mdd = mark / peak - 1;
    if (curve && last[i]) { days.push(b.day[i]); vals.push(mark); }
  }
  if (inPos) { const r = (c[to - 1] * (1 - cost)) / entry; eq *= r; trades++; if (r > 1) wins++; }
  return { ret: eq - 1, trades, wins, mdd, exposure: to > from ? barsIn / (to - from) : 0, days, vals };
}

// Buy at the first open, sell at the last close.
export function hold(b, { cost = 0.0005, from = 0, to = b.n, curve = false } = {}) {
  const ones = new Uint8Array(b.n).fill(1);
  const zeros = new Uint8Array(b.n);
  return simulate(b, ones, zeros, { cost, from: Math.max(from - 1, 0), to, curve });
}

// Turn an on/off state into enter/exit signals.
export function fromState(state) {
  const exit = new Uint8Array(state.length);
  for (let i = 0; i < state.length; i++) exit[i] = state[i] ? 0 : 1;
  return { enter: state, exit };
}
