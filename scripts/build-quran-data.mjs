// Builds quran/data/quran.json for the recitation video maker.
//
//   node scripts/build-quran-data.mjs <folder>
//
// <folder> holds these files from github.com/fawazahmed0/quran-api (branch 1):
//   editions/ara-quranuthmanihaf.json  (Hafs, Uthmani script)  -> ara-quranuthmanihaf.json
//   editions/ara-quranuthmanienc.json  (second Hafs copy)      -> ara-quranuthmanienc.json
//   editions/eng-ummmuhammad.json      (Saheeh International)  -> eng-ummmuhammad.json
//   info.json                          (surah names)           -> info.json
//
// The Hafs text is checked letter for letter against the second copy, so a
// typo in one source stops the build instead of reaching a video.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../rattil/lib/arabic.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/build-quran-data.mjs <folder>"); process.exit(1); }
const load = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

const hafs = load("ara-quranuthmanihaf.json").quran;
const check = load("ara-quranuthmanienc.json").quran;
const english = load("eng-ummmuhammad.json").quran;
const chapters = load("info.json").chapters;

// In this edition a space wrongly splits a word before the alef that follows
// an open tanween (e.g. "مَرَضࣰ اۖ"). Join those back, and drop the rub
// el-hizb mark and stray direction marks.
const OPEN_TANWEEN = /[ࣰ-ࣲ]$/;
export function cleanAyah(text) {
  const out = [];
  for (const w of text.replace(/[۞‎‏]/g, "").trim().split(/\s+/)) {
    if (out.length && /^[اى]/.test(w) && OPEN_TANWEEN.test(out[out.length - 1])) out[out.length - 1] += w;
    else out.push(w);
  }
  return out.join(" ");
}

const strip = (s) => normalize(s.replace(/۩/g, "")).replace(/ /g, "");
// Reviewed by hand: same word, spelled with a full alef in one copy and a
// dagger alef in the other (جَٰهَدَاكَ / جَـٰهَدَ ٰكَ).
const REVIEWED = new Set(["29:8"]);
let mismatches = 0;
const surahs = chapters.map((c) => ({ n: c.chapter, name: c.name, meaning: c.englishname, ar: [], en: [] }));
hafs.forEach((v, i) => {
  const other = check[i], en = english[i];
  if (other.chapter !== v.chapter || other.verse !== v.verse || en.chapter !== v.chapter || en.verse !== v.verse) throw new Error(`order differs at ${i}`);
  if (strip(v.text) !== strip(other.text) && !REVIEWED.has(`${v.chapter}:${v.verse}`)) { mismatches++; console.error(`text differs at ${v.chapter}:${v.verse}`); }
  surahs[v.chapter - 1].ar.push(cleanAyah(v.text));
  surahs[v.chapter - 1].en.push(en.text.trim());
});
if (mismatches) { console.error(`${mismatches} ayahs differ between the two copies; not writing.`); process.exit(1); }
surahs.forEach((s, i) => { if (s.ar.length !== chapters[i].verses.length) throw new Error(`surah ${s.n} has ${s.ar.length} ayahs`); });

writeFileSync(new URL("../rattil/data/quran.json", import.meta.url), JSON.stringify({ source: "fawazahmed0/quran-api: ara-quranuthmanihaf, eng-ummmuhammad", surahs }));
console.log(`wrote ${hafs.length} ayahs in ${surahs.length} surahs`);
