import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, words, arabicDigits } from "../rattil/lib/arabic.js";
import { buildIndex, matchRecitation } from "../rattil/lib/match.js";
import { breathGroups } from "../rattil/lib/audio.js";

const quran = JSON.parse(readFileSync(new URL("../rattil/data/quran.json", import.meta.url), "utf8"));
const index = buildIndex(quran);
const ayah = (s, a) => words(quran.surahs[s - 1].ar[a - 1]).join(" ");

// Rough imitation of the speech model's mistakes: a dropped letter here and there.
function garble(text, every = 4) {
  return text.split(" ").map((w, i) => (i % every === 2 && w.length > 3 ? w.slice(0, -1) : w)).join(" ");
}

test("normalize strips harakat and unifies letters", () => {
  assert.equal(normalize("ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ"), "الحمد لله رب العلمين");
  assert.equal(arabicDigits(52), "٥٢");
});

test("data has every surah and ayah, and no broken tanween spaces", () => {
  assert.equal(quran.surahs.length, 114);
  assert.equal(quran.surahs.reduce((n, s) => n + s.ar.length, 0), 6236);
  for (const s of quran.surahs) for (const t of s.ar) assert.ok(!/[ࣰ-ࣲ] [اى][ۖ-ۭ]?( |$)/.test(t));
});

test("finds Al-Qalam 1-6, one screen per ayah even when joined, ignoring the isti'adha", () => {
  const segs = [
    { start: 0.5, end: 3, text: "اعوذ بالله من الشيطن الرجيم" },
    { start: 3.5, end: 8, text: garble(ayah(68, 1)) },
    { start: 9, end: 14, text: garble(ayah(68, 2)) },
    { start: 15, end: 24, text: garble(ayah(68, 3) + " " + ayah(68, 4)) },
    { start: 25, end: 31, text: garble(ayah(68, 5) + " " + ayah(68, 6)) },
  ];
  const r = matchRecitation(quran, index, segs);
  assert.equal(r.surah, 68);
  assert.equal(r.from, 1);
  assert.equal(r.to, 6);
  assert.deepEqual(r.units.map((u) => u.ayahs), [[0], [1], [2], [3], [4], [5]]);
  // Ayahs 1, 2, 3 and 5 open a breath; 4 and 6 start inside one.
  assert.deepEqual([r.units[1].start, r.units[2].start, r.units[4].start], [9, 15, 25]);
  assert.ok(r.units[3].start > 15 && r.units[3].start < 24);
  assert.ok(r.units[5].start > 25 && r.units[5].start < 31);
});

test("a pause in the middle of an ayah keeps it on one screen", () => {
  const w = ayah(2, 255).split(" ");
  const segs = [
    { start: 1, end: 9, text: w.slice(0, 12).join(" ") },
    { start: 10, end: 20, text: w.slice(12, 30).join(" ") },
    { start: 21, end: 30, text: w.slice(30).join(" ") },
    { start: 31, end: 40, text: garble(ayah(2, 256)) },
  ];
  const r = matchRecitation(quran, index, segs);
  assert.equal(r.surah, 2);
  assert.equal(r.from, 255);
  assert.equal(r.to, 256);
  assert.deepEqual(r.units.map((u) => u.ayahs), [[254], [255]]);
  assert.equal(r.units[1].start, 31);
});

test("short surahs and the repeated refrain of Ar-Rahman", () => {
  const k = matchRecitation(quran, index, [1, 2, 3].map((a) => ({ start: a * 5, end: a * 5 + 4, text: ayah(108, a) })));
  assert.deepEqual([k.surah, k.from, k.to], [108, 1, 3]);
  const segs = [14, 15, 16, 17].map((a, i) => ({ start: i * 6, end: i * 6 + 5, text: garble(ayah(55, a), 3) }));
  const r = matchRecitation(quran, index, segs);
  assert.deepEqual([r.surah, r.from, r.to], [55, 14, 17]);
  assert.equal(r.units.length, 4);
});

test("a range picked by hand is used even if the words do not line up", () => {
  const segs = [{ start: 1, end: 5, text: "لا شيء" }, { start: 6, end: 9, text: "كلام" }];
  const r = matchRecitation(quran, index, segs, { surah: 112, from: 1, to: 4 });
  assert.deepEqual([r.surah, r.from, r.to], [112, 1, 4]);
  assert.deepEqual(r.units.map((u) => u.ayahs), [[0], [1], [2], [3]]);
  assert.equal(r.units[1].start, 6);
  assert.ok(r.units[3].start > r.units[2].start && r.units[3].start < 9);
});

test("noise returns no match", () => {
  assert.equal(matchRecitation(quran, index, [{ start: 0, end: 3, text: "hello world" }]), null);
});

test("breath groups split on pauses", () => {
  const rate = 16000, sig = new Float32Array(rate * 6);
  const tone = (a, b) => { for (let i = a * rate; i < b * rate; i++) sig[i] = 0.3 * Math.sin(i / 5); };
  tone(0.5, 2); tone(2.6, 4); tone(4.1, 5.5); // 0.6 s pause, then a 0.1 s dip that is not a pause
  const g = breathGroups(sig, rate);
  assert.equal(g.length, 2);
  assert.ok(Math.abs(g[0][0] - 0.5) < 0.02 && Math.abs(g[1][0] - 2.6) < 0.02 && Math.abs(g[1][1] - 5.5) < 0.02);
});
