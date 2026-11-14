// Finds which ayahs were recited by lining up the speech model's words with
// the verified Quran text, then works out when each ayah starts.
//
// The model's words are only used to locate and time the recitation; every
// word shown in the video comes from the verified text.

import { words, wordSimilarity } from "./arabic.js";

// quran: { surahs: [{ n, name, meaning, ar: [...], en: [...] }] }
export function buildIndex(quran) {
  const flat = []; // { s, a, w } surah number, 0-based ayah, normalized word
  for (const su of quran.surahs) su.ar.forEach((t, a) => { for (const w of words(t)) flat.push({ s: su.n, a, w }); });
  const grams = new Map(), pairs = new Map();
  const add = (m, k, i) => { let l = m.get(k); if (!l) m.set(k, (l = [])); if (l.length < 400) l.push(i); };
  for (let i = 0; i + 1 < flat.length; i++) {
    add(pairs, flat[i].w + " " + flat[i + 1].w, i);
    if (i + 2 < flat.length) add(grams, flat[i].w + " " + flat[i + 1].w + " " + flat[i + 2].w, i);
  }
  return { flat, grams, pairs };
}

// segments: [{ start, end, text }] one per breath group, in order.
// Each word gets a time by spreading the group's span over its letters.
export function timedWords(segments) {
  const out = [];
  segments.forEach((g, gi) => {
    const ws = words(g.text);
    const total = ws.reduce((n, w) => n + w.length + 1, 0) || 1;
    let pos = 0;
    ws.forEach((w, k) => {
      out.push({ w, g: gi, first: k === 0, t: g.start + (g.end - g.start) * (pos / total) });
      pos += w.length + 1;
    });
  });
  return out;
}

// Where in the Quran the transcript most likely sits: the flat-word offset
// most trigrams agree on. Returns null when nothing lines up.
export function locate(index, tw) {
  const votes = new Map();
  const lookups = [];
  for (let i = 0; i + 1 < tw.length; i++) {
    const tri = i + 2 < tw.length && index.grams.get(tw[i].w + " " + tw[i + 1].w + " " + tw[i + 2].w);
    if (tri) lookups.push([i, tri, 1]);
    const bi = index.pairs.get(tw[i].w + " " + tw[i + 1].w);
    if (bi && bi.length <= 60) lookups.push([i, bi, 0.4]);
  }
  for (const [i, hits, base] of lookups) {
    const weight = base / Math.sqrt(hits.length); // common phrases count less
    for (const p of hits) {
      const d = Math.round((p - i) / 4); // tolerate a few missed or extra words
      const v = votes.get(d) || { w: 0, at: [] };
      v.w += weight; v.at.push(p);
      votes.set(d, v);
    }
  }
  let best = null, bestV = 0;
  const w = (d) => votes.get(d)?.w || 0;
  for (const [d, v] of votes) {
    const v3 = v.w + 0.5 * (w(d - 1) + w(d + 1));
    if (v3 > bestV) { bestV = v3; best = d; }
  }
  if (best === null || bestV < 1) return null;
  // The middle of the matched stretch, by the median trigram hit.
  const at = votes.get(best).at.sort((a, b) => a - b);
  const p = Math.max(0, Math.min(index.flat.length - 1, at[at.length >> 1]));
  return { surah: index.flat[p].s, offset: p, score: bestV };
}

// Local alignment (Smith-Waterman) of transcript words against one surah's
// words. Extra words the reciter said (isti'adha, basmala, repeats) and
// unrecited parts of the surah are skipped for free at the ends.
export function align(tw, qw) {
  const n = tw.length, m = qw.length;
  const H = new Float32Array((n + 1) * (m + 1));
  const B = new Uint8Array((n + 1) * (m + 1)); // 1 diag, 2 up (skip transcript), 3 left (skip quran)
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = wordSimilarity(tw[i - 1].w, qw[j - 1]);
      const diag = H[(i - 1) * (m + 1) + j - 1] + (sim >= 0.6 ? 2 * sim : -1);
      const up = H[(i - 1) * (m + 1) + j] - 0.8;
      const left = H[i * (m + 1) + j - 1] - 0.8;
      let h = 0, b = 0;
      if (diag > h) { h = diag; b = 1; }
      if (up > h) { h = up; b = 2; }
      if (left > h) { h = left; b = 3; }
      H[i * (m + 1) + j] = h; B[i * (m + 1) + j] = b;
      if (h > best) { best = h; bi = i; bj = j; }
    }
  }
  const pairs = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && B[i * (m + 1) + j]) {
    const b = B[i * (m + 1) + j];
    if (b === 1) { if (wordSimilarity(tw[i - 1].w, qw[j - 1]) >= 0.6) pairs.push([i - 1, j - 1]); i--; j--; }
    else if (b === 2) i--;
    else j--;
  }
  return { pairs: pairs.reverse(), score: best };
}

// Word list of a surah with each word's ayah.
function surahWords(quran, s, from = 0, to = Infinity) {
  const su = quran.surahs[s - 1], ws = [], ayahOf = [];
  su.ar.forEach((t, a) => {
    if (a < from || a > to) return;
    for (const w of words(t)) { ws.push(w); ayahOf.push(a); }
  });
  return { ws, ayahOf };
}

// The main entry point.
// segments: breath groups with the model's text, [{ start, end, text }].
// force: optional { surah, from, to } (1-based ayahs) chosen by the person.
// Returns { surah, from, to, units, coverage } or null if nothing matched.
// units: [{ start, ayahs: [0-based ayah indices shown together] }]
export function matchRecitation(quran, index, segments, force = null) {
  const tw = timedWords(segments);
  if (!tw.length) return force && segments.length ? fallbackUnits(quran, segments, force.surah, force.from - 1, force.to - 1) : null;
  let surah, lo = 0, hi = Infinity;
  if (force) { surah = force.surah; lo = force.from - 1; hi = force.to - 1; }
  else {
    const loc = locate(index, tw);
    if (!loc) return null;
    surah = loc.surah;
    // Only look at ayahs near where the trigrams pointed (keeps long surahs fast).
    const span = tw.length * 2 + 60;
    lo = index.flat[Math.max(0, loc.offset - span)].s === surah ? index.flat[Math.max(0, loc.offset - span)].a : 0;
    const e = index.flat[Math.min(index.flat.length - 1, loc.offset + tw.length + span)];
    hi = e.s === surah ? e.a : Infinity;
  }
  const { ws, ayahOf } = surahWords(quran, surah, lo, hi);
  const { pairs } = align(tw, ws);
  if (pairs.length < 2) return force ? fallbackUnits(quran, segments, surah, lo, hi) : null;

  let from = force ? lo : ayahOf[pairs[0][1]];
  let to = force ? Math.min(hi, quran.surahs[surah - 1].ar.length - 1) : ayahOf[pairs[pairs.length - 1][1]];
  const extra = []; // ayahs found by comparing whole breath groups: { a, g }
  if (!force) {
    // Breath groups before the first or after the last lined-up word may still
    // be ayahs the model heard badly. Compare each whole group with the
    // neighbouring ayah's letters.
    const ar = quran.surahs[surah - 1].ar;
    const groupText = (g) => tw.filter((x) => x.g === g).map((x) => x.w).join("");
    const close = (g, a) => a >= 0 && a < ar.length && groupText(g) && wordSimilarity(groupText(g), words(ar[a]).join("")) >= 0.45;
    for (let g = tw[pairs[pairs.length - 1][0]].g + 1; g < segments.length && close(g, to + 1); g++) extra.push({ a: ++to, g });
    for (let g = tw[pairs[0][0]].g - 1; g >= 0 && close(g, from - 1); g--) extra.push({ a: --from, g });
  }

  // Earliest heard word of each ayah.
  const firstWord = new Map();
  for (const [ti, qi] of pairs) { const a = ayahOf[qi]; if (!firstWord.has(a)) firstWord.set(a, { ti, qi }); }

  // Each ayah's start: its first heard word, or for an ayah the model missed
  // entirely, right after the previous one.
  const starts = [];
  for (let a = from; a <= to; a++) {
    const f = firstWord.get(a), x = extra.find((e) => e.a === a);
    const ti = f ? f.ti : x ? tw.findIndex((w) => w.g === x.g) : null;
    starts.push(ti !== null ? { a, ti, t: tw[ti].t } : { a, ti: null, t: null });
  }
  starts.forEach((s, k) => { if (s.t === null) s.t = k ? starts[k - 1].t + 0.01 : segments[0].start; });

  // Ayahs that begin at a breath start their own screen. One that begins
  // in the middle of a breath shares the screen with the ayah before it:
  // the pause is the only boundary we trust.
  const units = [];
  for (const s of starts) {
    const atBreath = s.ti !== null && tw[s.ti].first;
    const cur = units[units.length - 1];
    if (!cur || (atBreath && s.t > cur.start + 0.5) || cur.ayahs.length >= 3) {
      units.push({ start: atBreath ? segments[tw[s.ti].g].start : s.t, ayahs: [s.a] });
    } else cur.ayahs.push(s.a);
  }
  if (units.length) units[0].start = Math.min(units[0].start, segments[0].start);

  const recited = to - from + 1;
  const heard = new Set(pairs.map(([, qi]) => qi)).size + extra.reduce((n, e) => n + words(quran.surahs[surah - 1].ar[e.a]).length, 0);
  return { surah, from: from + 1, to: to + 1, units, coverage: heard / ws.filter((_, k) => ayahOf[k] >= from && ayahOf[k] <= to).length, ayahCount: recited };
}

// When the person picked the range but the model's words could not be lined
// up: one screen per breath group, in order, extra ayahs on the last screen.
function fallbackUnits(quran, segments, surah, lo, hi) {
  hi = Math.min(hi, quran.surahs[surah - 1].ar.length - 1);
  const units = [];
  for (let a = lo; a <= hi; a++) {
    const g = segments[Math.min(a - lo, segments.length - 1)];
    const cur = units[units.length - 1];
    if (cur && cur.start === g.start) cur.ayahs.push(a); else units.push({ start: g.start, ayahs: [a] });
  }
  return { surah, from: lo + 1, to: hi + 1, units, coverage: 0, ayahCount: hi - lo + 1 };
}
