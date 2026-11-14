import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanScene, drawScene, GLYPH_NAMES } from "../rattil/lib/scenes.js";
import { cleanPlan, parseJson, planPrompt, scenesPrompt } from "../lib/rattil-prompt.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/scenes-kawthar.json", import.meta.url), "utf8"));

// A canvas context that records nothing, for checking drawing doesn't throw.
const stub = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });

test("fixture scenes survive cleaning intact", () => {
  for (const s of fixture.scenes) assert.equal(cleanScene(s).elements.length, s.elements.length);
});

test("cleaning drops unknown types and glyphs and clamps numbers", () => {
  const c = cleanScene({ elements: [
    { type: "face" }, { type: "glyph", name: "camel" },
    { type: "glyph", name: "sun", x: 99999, size: -5, width: 40, alpha: 9, at: 7 },
    { type: "particles", count: 100000, mode: "explode" },
    { type: "path", points: [[1, 2]] },
  ] });
  assert.equal(c.elements.length, 2);
  const [sun, parts] = c.elements;
  assert.deepEqual([sun.x, sun.size, sun.width, sun.alpha, sun.at], [1130, 20, 5, 1, 0.95]);
  assert.deepEqual([parts.count, parts.mode], [120, "drift"]);
  assert.equal(cleanScene({ elements: [{ type: "nope" }] }), null);
  assert.equal(cleanScene("junk"), null);
});

test("every element type and glyph draws without errors", () => {
  const elements = [
    ...GLYPH_NAMES.map((name, i) => ({ type: "glyph", name, x: 100 + i * 20, y: 200, motion: { kind: ["float", "sway", "pulse", "rise", "sink", "drift", "spin", "grow", "shrink", "flicker"][i % 10] } })),
    { type: "path", points: [[0, 0], [100, 50], [200, 0]], smooth: true, closed: true },
    { type: "circle", from: 0, to: 270 }, { type: "wave" }, { type: "rays" }, { type: "ripples" }, { type: "branch", depth: 6 },
    ...["rise", "fall", "drift", "orbit", "converge", "scatter", "twinkle"].map((mode) => ({ type: "particles", mode })),
    { type: "dots", points: [[1, 1], [2, 2]], end: 0.5 },
  ];
  // cleanScene keeps at most 16, so check in batches.
  for (let i = 0; i < elements.length; i += 16) {
    const s = cleanScene({ elements: elements.slice(i, i + 16) });
    for (const t of [0, 0.5, 2, 5, 9]) drawScene(stub, s, t, 8);
  }
});

test("plans are reshaped to one entry per ayah and size-limited", () => {
  const p = cleanPlan({ theme: "x".repeat(2000), thread: "t", ayahs: [{ n: 2, meaning: "m", image: "i" }, { n: 99, meaning: "ignored" }] }, 1, 3);
  assert.equal(p.theme.length, 500);
  assert.deepEqual(p.ayahs.map((a) => a.n), [1, 2, 3]);
  assert.equal(p.ayahs[1].image, "i");
  assert.throws(() => cleanPlan({}, 1, 2));
});

test("JSON is found inside a wordy reply", () => {
  assert.deepEqual(parseJson('Here you go:\n```json\n{"a": [1, {"b": 2}]}\n```'), { a: [1, { b: 2 }] });
  assert.throws(() => parseJson("no json"));
});

test("prompts carry the passage, the rules and the glyph list", () => {
  const passage = { surah: 108, name: "Al-Kawthar", from: 1, to: 3, ayahs: [1, 2, 3].map((n) => ({ n, ar: "ar" + n, en: "en" + n })) };
  const plan = planPrompt(passage);
  assert.match(plan.system, /Never depict people/);
  assert.match(plan.user, /\[3\] ar3\nen3/);
  const sc = scenesPrompt(passage, cleanPlan(fixture.plan, 1, 3), [2, 3]);
  assert.match(sc.system, /niche/);
  assert.match(sc.user, /\[2\] meaning:/);
  assert.doesNotMatch(sc.user, /\[1\] meaning:/);
});
