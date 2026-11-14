// Daily spending cap for Rattil's Claude calls.
//
// Before each call, its worst-case cost (all of max_tokens used) is reserved
// against today's total; if that would pass the cap, the call is refused.
// After the call, the reservation is replaced by the real cost from the
// API's token counts. Reserving first means parallel calls can't overshoot.
//
// Totals live in Upstash Redis (add it in Vercel → Storage; it sets
// KV_REST_API_URL / KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / _TOKEN).
// Without it, no calls are made at all (it fails closed).
// The day runs midnight to midnight Pacific time.
// DAILY_LIMIT_USD changes the cap (default 1).

// Claude Sonnet 5.5 list prices, USD per million tokens.
export const PRICE = { input: 2, output: 10 };
const MICRO = 1e6; // totals are kept in micro-dollars, as integers

export const dailyLimitUsd = (v = process.env.DAILY_LIMIT_USD) => (Number(v) > 0 ? Number(v) : 1);
export const costUsd = (inputTokens, outputTokens) => (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6;
// Upper bound before a call: about 2 characters per token for Arabic-heavy prompts.
export const estimateUsd = (promptChars, maxTokens) => costUsd(Math.ceil(promptChars / 2), maxTokens);

export function dayKey(now = new Date()) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `rattil:spend:${d}`;
}

export function redisFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (...command) => {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`spend store: ${data.error || res.status}`);
    return data.result;
  };
}

export class OverLimit extends Error {}

// Run `call` (which resolves to { result, usage: { input_tokens, output_tokens } })
// within today's cap. Returns result.
export async function withinDailyLimit(redis, estimate, call, { limit = dailyLimitUsd(), now = new Date() } = {}) {
  if (!redis) throw new Error("spending limit storage isn't set up");
  const key = dayKey(now), reserve = Math.ceil(estimate * MICRO);
  const total = Number(await redis("INCRBY", key, reserve));
  if (total === reserve) await redis("EXPIRE", key, 60 * 60 * 72);
  if (total > limit * MICRO) {
    await redis("INCRBY", key, -reserve);
    throw new OverLimit(`daily limit of $${limit} reached`);
  }
  let actual = reserve;
  try {
    const { result, usage } = await call();
    actual = Math.ceil(costUsd(usage?.input_tokens || 0, usage?.output_tokens || 0) * MICRO);
    return result;
  } catch (err) {
    // A failed call may still have been billed for input; keep a small charge.
    actual = Math.ceil(estimate * 0.2 * MICRO);
    throw err;
  } finally {
    await redis("INCRBY", key, actual - reserve).catch(() => {});
  }
}

export async function spentTodayUsd(redis, now = new Date()) {
  return redis ? Number((await redis("GET", dayKey(now))) || 0) / MICRO : null;
}
