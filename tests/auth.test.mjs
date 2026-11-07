import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { setGoogleKeys, verifyGoogleToken, allowedList, isAllowed, DEFAULT_ALLOWED } from "../lib/google.js";
import { createSession, readSession, getCookie } from "../lib/session.js";
import middleware from "../middleware.js";
import auth from "../api/auth.js";

const CLIENT = "client-123.apps.googleusercontent.com";
const SECRET = "x".repeat(40);
let privateKey;
let otherKey;

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  setGoogleKeys(createLocalJWKSet({ keys: [jwk] }));
});

const googleToken = (claims = {}, key = privateKey, exp = "5m") =>
  new SignJWT({ iss: "https://accounts.google.com", aud: CLIENT, email: "ansari342@gmail.com", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);

const env = (vars) => {
  for (const k of ["GOOGLE_CLIENT_ID", "SESSION_SECRET", "ALLOWED_EMAILS"]) delete process.env[k];
  Object.assign(process.env, vars);
};
const req = (path, cookie) => new Request(`https://site.test${path}`, { headers: cookie ? { cookie } : {} });

test("only ansari342@gmail.com is allowed by default", () => {
  env({});
  assert.deepEqual(DEFAULT_ALLOWED, ["ansari342@gmail.com"]);
  assert.ok(isAllowed("Ansari342@Gmail.com"));
  assert.ok(!isAllowed("someone@gmail.com"));
  assert.deepEqual(allowedList("a@x.com, B@y.com"), ["a@x.com", "b@y.com"]);
});

test("Google tokens are checked for signature, audience, issuer, expiry and verified email", async () => {
  assert.equal(await verifyGoogleToken(await googleToken(), CLIENT), "ansari342@gmail.com");
  await assert.rejects(verifyGoogleToken(await googleToken({ aud: "other-client" }), CLIENT));
  await assert.rejects(verifyGoogleToken(await googleToken({ iss: "https://evil.test" }), CLIENT));
  await assert.rejects(verifyGoogleToken(await googleToken({ email_verified: false }), CLIENT));
  await assert.rejects(verifyGoogleToken(await googleToken({}, otherKey), CLIENT));
  await assert.rejects(verifyGoogleToken(await googleToken({}, privateKey, "-1m"), CLIENT));
});

test("a session is valid only for the allowed account", async () => {
  env({ GOOGLE_CLIENT_ID: CLIENT });
  assert.equal(await readSession(await googleToken()), "ansari342@gmail.com");
  assert.equal(await readSession(await googleToken({ email: "someone@gmail.com" })), null);
  assert.equal(await readSession("garbage"), null);
  assert.equal(await readSession(""), null);
});

test("signed 7-day sessions work only when SESSION_SECRET is set, and can't be forged", async () => {
  env({ GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: SECRET });
  const t = await createSession("ansari342@gmail.com", SECRET);
  assert.equal(await readSession(t), "ansari342@gmail.com");
  const [, , sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "ansari342@gmail.com", x: 9999999999 })).toString("base64url");
  assert.equal(await readSession(`s.${forged}.${sig}`), null);
  assert.equal(await readSession(t, { now: Date.now() + 8 * 864e5 }), null);
  env({ GOOGLE_CLIENT_ID: CLIENT });
  assert.equal(await readSession(t), null);
});

test("signed-out visitors are sent to the Coming soon page; the API returns 401", async () => {
  env({ GOOGLE_CLIENT_ID: CLIENT });
  const page = await middleware(req("/trading/"));
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "https://site.test/trading/login.html");
  assert.equal((await middleware(req("/trading/data/SPUS.json"))).status, 302);
  assert.equal((await middleware(req("/api/prices?symbols=SPUS"))).status, 401);
  assert.equal((await middleware(req("/trading/login.html"))).headers.get("x-middleware-next"), "1");
});

test("the allowed account gets in; any other Google account does not", async () => {
  env({ GOOGLE_CLIENT_ID: CLIENT });
  const mine = `x=1; lab_session=${await googleToken()}`;
  assert.equal(getCookie(req("/", mine)).split(".").length, 3);
  assert.equal((await middleware(req("/trading/", mine))).headers.get("x-middleware-next"), "1");
  const theirs = `lab_session=${await googleToken({ email: "someone@gmail.com" })}`;
  assert.equal((await middleware(req("/trading/", theirs))).status, 302);
});

test("it fails closed when GOOGLE_CLIENT_ID isn't set", async () => {
  const cookie = `lab_session=${await googleToken()}`;
  env({});
  assert.equal((await middleware(req("/trading/", cookie))).status, 302);
});

const post = (body, headers = {}) =>
  new Request("https://site.test/api/auth", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test", ...headers }, body: JSON.stringify(body) });

test("sign-in: allowed account gets a cookie, others get 'coming soon' and no cookie", async () => {
  env({ GOOGLE_CLIENT_ID: CLIENT });
  const ok = await auth(post({ credential: await googleToken() }));
  assert.deepEqual(await ok.json(), { allowed: true });
  assert.match(ok.headers.get("set-cookie"), /^lab_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/);

  const other = await auth(post({ credential: await googleToken({ email: "someone@gmail.com" }) }));
  assert.equal(other.status, 200);
  assert.deepEqual(await other.json(), { allowed: false });
  assert.equal(other.headers.get("set-cookie"), null);

  assert.equal((await auth(post({ credential: await googleToken({}, otherKey) }))).status, 401);
  assert.equal((await auth(post({ credential: await googleToken() }, { origin: "https://evil.test" }))).status, 403);
  env({});
  assert.equal((await auth(post({ credential: await googleToken() }))).status, 500);
});
