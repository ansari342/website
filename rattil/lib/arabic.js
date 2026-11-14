// Arabic text helpers shared by the browser app, the data build and the tests.

// Harakat, Quranic annotation marks, tatweel and direction marks.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ‎‏]/g;
const LETTERS = { "ٱ": "ا", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ی": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه", "ک": "ك", "ء": "" };

// The bare letter skeleton of a word, so the model's spelling and the
// Uthmani spelling can be compared.
export function normalize(s) {
  return s.replace(MARKS, "").replace(/[ٱأإآىیئؤةکء]/g, (c) => LETTERS[c])
    .replace(/[^ء-ي\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}

export const words = (s) => normalize(s).split(" ").filter(Boolean);

const DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const arabicDigits = (n) => String(n).replace(/\d/g, (d) => DIGITS[d]);

// Levenshtein distance, early exit above max.
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// 1 for the same word, falling toward 0 as the spelling differs.
export function wordSimilarity(a, b) {
  const m = Math.max(a.length, b.length);
  if (!m) return 1;
  return Math.max(0, 1 - editDistance(a, b, m) / m);
}
