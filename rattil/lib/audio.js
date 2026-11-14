// Audio helpers: find the reciter's breath groups from pauses.

// Loudness envelope in dB, one value per `hop` seconds.
export function envelope(samples, rate, hop = 0.01) {
  const n = Math.max(1, Math.round(rate * hop));
  const out = new Float32Array(Math.floor(samples.length / n));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    for (let i = f * n, e = i + n; i < e; i++) sum += samples[i] * samples[i];
    out[f] = 10 * Math.log10(sum / n + 1e-12);
  }
  return out;
}

function percentile(values, p) {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// Breath groups: stretches of recitation separated by pauses of at least
// `minPause` seconds where the level drops `drop` dB below the loud parts.
// Groups longer than `maxLen` are split at their quietest moment so each
// fits in one 30-second window of the speech model.
export function breathGroups(samples, rate, { minPause = 0.3, drop = 22, minGroup = 0.6, maxLen = 28 } = {}) {
  const hop = 0.01;
  const db = envelope(samples, rate, hop);
  if (!db.length) return [];
  const loud = percentile(db, 0.95);
  const quiet = (f) => db[f] < loud - drop;
  const groups = [];
  let start = null, silent = 0;
  for (let f = 0; f <= db.length; f++) {
    const q = f === db.length || quiet(f);
    if (!q) { if (start === null) start = f; silent = 0; continue; }
    silent++;
    if (start !== null && (silent * hop >= minPause || f === db.length)) {
      groups.push([start * hop, (f - silent + 1) * hop]);
      start = null;
    }
  }
  // Drop clicks and coughs that are too short to be words.
  const kept = groups.filter(([s, e]) => e - s >= minGroup);
  return kept.flatMap(([s, e]) => splitLong(s, e, db, hop, maxLen));
}

function splitLong(s, e, db, hop, maxLen) {
  if (e - s <= maxLen) return [[s, e]];
  // Quietest 0.2 s window in the middle half of the group.
  const a = Math.floor((s + (e - s) * 0.25) / hop), b = Math.floor((s + (e - s) * 0.75) / hop);
  let best = a, bestDb = Infinity;
  for (let f = a; f < b - 20; f++) {
    let m = 0;
    for (let k = 0; k < 20; k++) m += db[f + k];
    if (m < bestDb) { bestDb = m; best = f + 10; }
  }
  const cut = best * hop;
  return [...splitLong(s, cut, db, hop, maxLen), ...splitLong(cut, e, db, hop, maxLen)];
}

// Average stereo to mono and resample with linear interpolation.
export function toMono16k(channels, rate, target = 16000) {
  const len = channels[0].length;
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / channels.length;
  if (rate === target) return mono;
  const out = new Float32Array(Math.floor(len * target / rate));
  const step = rate / target;
  for (let i = 0; i < out.length; i++) {
    const x = i * step, j = Math.floor(x), t = x - j;
    out[i] = mono[j] * (1 - t) + (mono[j + 1] ?? mono[j]) * t;
  }
  return out;
}
