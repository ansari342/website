import { test } from "node:test";
import assert from "node:assert/strict";
import { passcode, checkPasscode, createSession, isUnlocked, DEFAULT_PASSCODE, getCookie } from "../lib/session.js";
import middleware from "../middleware.js";
import unlock from "../api/unlock.js";

const req = (path, cookie) => new Request(`https://site.test${path}`, { headers: cookie ? { cookie } : {} });
const post = (body, headers = {}) =>
  new Request("https://site.test/api/unlock", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test", ...headers }, body: JSON.stringify(body) });

test("the passcode is 12345 unless TRADING_PASSCODE is set", () => {
  delete process.env.TRADING_PASSCODE;
  assert.equal(DEFAULT_PASSCODE, "12345");
  assert.equal(passcode(), "12345");
  assert.ok(checkPasscode("12345") && checkPasscode(" 12345 "));
  assert.ok(!checkPasscode("1234") && !checkPasscode("123456") && !checkPasscode("") && !checkPasscode(12345));
  process.env.TRADING_PASSCODE = "open-sesame";
  assert.ok(checkPasscode("open-sesame") && !checkPasscode("12345"));
  delete process.env.TRADING_PASSCODE;
});

test("unlock cookies can't be forged, expire, and stop working when the passcode changes", async () => {
  const t = await createSession("12345");
  assert.ok(await isUnlocked(t, "12345"));
  assert.ok(!(await isUnlocked(t, "99999")));
  const [exp, sig] = t.split(".");
  assert.ok(!(await isUnlocked(`${Number(exp) + 999999}.${sig}`, "12345")));
  assert.ok(!(await isUnlocked(t, "12345", Date.now() + 31 * 864e5)));
  assert.ok(!(await isUnlocked("garbage", "12345")) && !(await isUnlocked("", "12345")));
});

test("locked visitors go to Coming soon; the API returns 401; the page itself is public", async () => {
  const page = await middleware(req("/trading/"));
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "https://site.test/trading/login.html");
  assert.equal((await middleware(req("/trading/data/SPUS.json"))).status, 302);
  assert.equal((await middleware(req("/api/prices?symbols=SPUS"))).status, 401);
  assert.equal((await middleware(req("/trading/login.html"))).headers.get("x-middleware-next"), "1");
});

test("the right passcode unlocks the lab; a wrong one doesn't", async () => {
  const ok = await unlock(post({ code: "12345" }));
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get("set-cookie");
  assert.match(setCookie, /^lab_session=\d+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  const cookie = setCookie.split(";")[0];
  assert.equal(getCookie(req("/", `a=1; ${cookie}`)), cookie.split("=")[1]);
  assert.equal((await middleware(req("/trading/", cookie))).headers.get("x-middleware-next"), "1");

  const t0 = Date.now();
  const bad = await unlock(post({ code: "00000" }));
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  assert.ok(Date.now() - t0 >= 700, "wrong guesses are slowed down");
  assert.equal((await unlock(post({ code: "12345" }, { origin: "https://evil.test" }))).status, 403);
});
