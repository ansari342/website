import { test } from "node:test";
import assert from "node:assert/strict";
import { withinDailyLimit, OverLimit, dayKey, costUsd, estimateUsd } from "../lib/spend.js";

// An in-memory stand-in for Redis.
function fakeRedis() {
  const m = new Map();
  return Object.assign(async (cmd, key, n) => {
    if (cmd === "INCRBY") { m.set(key, (m.get(key) || 0) + Number(n)); return m.get(key); }
    if (cmd === "GET") return m.get(key) ?? null;
    return 1;
  }, { m });
}

test("real cost is recorded, and calls that could pass $1 a day are refused", async () => {
  const redis = fakeRedis(), now = new Date("2026-11-14T20:00:00Z");
  assert.equal(dayKey(now), "rattil:spend:2026-11-14");
  assert.equal(costUsd(1e6, 1e6), 12);
  const usage = { input_tokens: 5000, output_tokens: 4000 }; // $0.05
  assert.equal(await withinDailyLimit(redis, 0.1, async () => ({ result: "ok", usage }), { now }), "ok");
  assert.equal(redis.m.get(dayKey(now)), 50000); // micro-dollars
  for (let i = 0; i < 18; i++) await withinDailyLimit(redis, 0.1, async () => ({ result: 1, usage }), { now });
  assert.equal(redis.m.get(dayKey(now)), 950000); // $0.95
  await assert.rejects(withinDailyLimit(redis, 0.1, async () => ({ result: 1, usage }), { now }), OverLimit);
  assert.equal(redis.m.get(dayKey(now)), 950000); // refused calls cost nothing
  assert.equal(await withinDailyLimit(redis, 0.1, async () => ({ result: "next day", usage }), { now: new Date("2026-11-15T09:00:00Z") }), "next day");
});

test("parallel calls can't overshoot, and no storage means no calls", async () => {
  const redis = fakeRedis(), now = new Date();
  const slow = () => new Promise((r) => setTimeout(() => r({ result: 1, usage: { input_tokens: 0, output_tokens: 30000 } }), 10)); // $0.30 each
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => withinDailyLimit(redis, 0.3, slow, { now })));
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 3);
  assert.ok(redis.m.get(dayKey(now)) <= 1e6);
  await assert.rejects(withinDailyLimit(null, 0.1, slow), /storage/);
  assert.ok(estimateUsd(4000, 8000) > 0.08);
});
