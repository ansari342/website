import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanWorld, cleanMoment, defaultMoments, LANDS, MOMENT_FIELDS, presetExample } from "../rattil/lib/world.js";
import { worldPrompt } from "../lib/rattil-prompt.js";

test("sky moments are cleaned: ranges clamped, bad colours and landscapes replaced", () => {
  const m = cleanMoment({ sun: 7, rain: -2, altitude: 0.5, sky: ["#000000", "#111111", "#222222", "#333333"], land: "volcano", landColor: "red", cloudColor: "#abcdef" });
  assert.deepEqual([m.sun, m.rain, m.altitude, m.land], [1, 0, 0.5, "mountains"]);
  assert.deepEqual(m.sky[3], [51, 51, 51]);
  assert.deepEqual(m.cloudColor, [171, 205, 239]);
  assert.equal(m.landColor.length, 3);
  assert.equal(cleanMoment("junk"), null);
  assert.equal(cleanMoment({ sky: ["#000000"] }).sky.length, 4);
});

test("a designed world keeps only ayahs in the passage, once each", () => {
  const w = cleanWorld({ frames: [{ ayah: 1, land: "sea" }, { ayah: 1, land: "dunes" }, { ayah: 9 }, { ayah: 3, land: "space", altitude: 1 }] }, 1, 3);
  assert.deepEqual(Object.keys(w), ["1", "3"]);
  assert.equal(w[1].land, "sea");
  assert.equal(cleanWorld({ frames: [] }, 1, 3), null);
  assert.equal(cleanWorld(null, 1, 3), null);
});

test("default journey has a moment per screen", () => {
  for (const n of [1, 2, 3, 4, 6, 12]) {
    const d = defaultMoments(n);
    assert.equal(d.length, n);
    for (const m of d) assert.ok(LANDS.includes(m.land) && m.sky.length === 4);
  }
});

test("sky prompt carries the verses and the field list, and asks for a different design when told", () => {
  const p = { surah: 108, name: "Al-Kawthar", from: 1, to: 3, ayahs: [1, 2, 3].map((n) => ({ n, ar: "ar" + n, en: "en" + n })) };
  const { system, user } = worldPrompt(p, MOMENT_FIELDS, presetExample(), "night to dawn");
  assert.match(system, /No people/);
  assert.match(user, /\[3\] ar3\nen3/);
  assert.match(user, /altitude 0\.\.1/);
  assert.match(user, /different design.*night to dawn/);
  assert.equal(cleanMoment(presetExample()).land, "mountains");
});
