import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, sessionEmail, allowedEmails, isAllowed, idTokenClaims, safeNext } from "../lib/google-auth.js";
import { withinDailyLimit, OverLimit, dayKey, costUsd, estimateUsd } from "../lib/spend.js";
import middleware from "../middleware.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;

test("only the allowlisted email is allowed, by default ansari342@gmail.com", () => {
  assert.deepEqual(allowedEmails(""), ["ansari342@gmail.com"]);
  assert.ok(isAllowed("Ansari342@Gmail.com", allowedEmails("")));
  assert.ok(!isAllowed("someone@gmail.com", allowedEmails("")));
  assert.deepEqual(allowedEmails(" a@x.com, B@y.com "), ["a@x.com", "b@y.com"]);
});

test("sessions are signed, expire, and stop working if the email is removed from the list", async () => {
  const token = await createSession("ansari342@gmail.com", "s3cret", Date.now());
  assert.equal(await sessionEmail(token, "s3cret", Date.now(), ["ansari342@gmail.com"]), "ansari342@gmail.com");
  assert.equal(await sessionEmail(token, "other", Date.now(), ["ansari342@gmail.com"]), null);
  assert.equal(await sessionEmail(token, "s3cret", Date.now() + 31 * 864e5, ["ansari342@gmail.com"]), null);
  assert.equal(await sessionEmail(token, "s3cret", Date.now(), ["x@y.com"]), null);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "someone@gmail.com", exp: 9e9 })).toString("base64url");
  assert.equal(await sessionEmail(`${forged}.${sig}`, "s3cret", Date.now(), ["someone@gmail.com"]), null);
  assert.equal(await sessionEmail(token, undefined), null); // no secret: nobody gets in
});

test("ID tokens must be for this app, from Google, current and verified", () => {
  const ok = { aud: "cid", iss: "https://accounts.google.com", exp: Date.now() / 1000 + 60, email: "a@b.c", email_verified: true };
  assert.equal(idTokenClaims(idToken(ok), "cid").email, "a@b.c");
  assert.throws(() => idTokenClaims(idToken({ ...ok, aud: "other" }), "cid"));
  assert.throws(() => idTokenClaims(idToken({ ...ok, iss: "evil" }), "cid"));
  assert.throws(() => idTokenClaims(idToken({ ...ok, exp: 1 }), "cid"));
  assert.throws(() => idTokenClaims(idToken({ ...ok, email_verified: false }), "cid"));
});

test("return paths stay on this site", () => {
  assert.equal(safeNext("/rattil/"), "/rattil/");
  assert.equal(safeNext("//evil.com"), "/rattil/");
  assert.equal(safeNext("https://evil.com"), "/rattil/");
});

test("middleware guards only the AI animations API, for the owner", async () => {
  process.env.AUTH_SECRET = "s3cret"; delete process.env.ALLOWED_EMAILS;
  const api = (cookie = "") => middleware(new Request("https://site.test/api/rattil-scenes", { method: "POST", headers: { cookie } }));
  assert.equal((await api()).status, 401);
  assert.equal((await api(`rattil_session=${await createSession("ansari342@gmail.com", "s3cret")}`)).headers.get("x-middleware-next"), "1");
  assert.equal((await api(`rattil_session=${await createSession("someone@gmail.com", "s3cret")}`)).status, 401);
  const { config } = await import("../middleware.js");
  assert.ok(!config.matcher.some((m) => m.startsWith("/rattil"))); // the page itself is public
});

// An in-memory stand-in for Redis.
function fakeRedis() {
  const m = new Map();
  return Object.assign(async (cmd, key, n) => {
    if (cmd === "INCRBY") { m.set(key, (m.get(key) || 0) + Number(n)); return m.get(key); }
    if (cmd === "GET") return m.get(key) ?? null;
    return 1;
  }, { m });
}

test("spending: real cost is recorded, and calls that could pass $1 a day are refused", async () => {
  const redis = fakeRedis(), now = new Date("2026-11-14T20:00:00Z");
  assert.equal(dayKey(now), "rattil:spend:2026-11-14");
  assert.equal(costUsd(1e6, 1e6), 12);
  const usage = { input_tokens: 5000, output_tokens: 4000 }; // $0.05
  const r = await withinDailyLimit(redis, 0.1, async () => ({ result: "ok", usage }), { now });
  assert.equal(r, "ok");
  assert.equal(redis.m.get(dayKey(now)), 50000); // micro-dollars
  for (let i = 0; i < 18; i++) await withinDailyLimit(redis, 0.1, async () => ({ result: 1, usage }), { now });
  assert.equal(redis.m.get(dayKey(now)), 950000); // $0.95
  await assert.rejects(withinDailyLimit(redis, 0.1, async () => ({ result: 1, usage }), { now }), OverLimit);
  assert.equal(redis.m.get(dayKey(now)), 950000); // refused calls cost nothing
  // a new Pacific day starts fresh
  assert.equal(await withinDailyLimit(redis, 0.1, async () => ({ result: "next day", usage }), { now: new Date("2026-11-15T09:00:00Z") }), "next day");
});

test("spending: parallel calls can't overshoot, and no storage means no calls", async () => {
  const redis = fakeRedis(), now = new Date();
  const slow = () => new Promise((r) => setTimeout(() => r({ result: 1, usage: { input_tokens: 0, output_tokens: 30000 } }), 10)); // $0.30 each
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => withinDailyLimit(redis, 0.3, slow, { now })));
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 3);
  assert.ok(redis.m.get(dayKey(now)) <= 1e6);
  await assert.rejects(withinDailyLimit(null, 0.1, slow), /storage/);
  assert.ok(estimateUsd(4000, 8000) > 0.08);
});
