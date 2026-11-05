import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createSession, readSession, allowedEmails, getCookie } from "../lib/session.js";
import middleware from "../middleware.js";
import { verifyGoogleToken } from "../api/auth.js";

const SECRET = "x".repeat(40);
const ALLOWED = allowedEmails("Owner@Example.com, second@example.com");

test("a fresh session for an allowed email is accepted", async () => {
  const t = await createSession("owner@example.com", SECRET);
  assert.equal(await readSession(t, SECRET, ALLOWED), "owner@example.com");
});

test("tampered, expired, wrongly signed or disallowed sessions are rejected", async () => {
  const t = await createSession("owner@example.com", SECRET);
  const [p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "owner@example.com", x: 9999999999 })).toString("base64url");
  assert.equal(await readSession(`${forged}.${s}`, SECRET, ALLOWED), null);
  assert.equal(await readSession(t, "y".repeat(40), ALLOWED), null);
  assert.equal(await readSession(t, SECRET, ALLOWED, Date.now() + 8 * 864e5), null);
  assert.equal(await readSession(await createSession("stranger@example.com", SECRET), SECRET, ALLOWED), null);
  assert.equal(await readSession(`${p}`, SECRET, ALLOWED), null);
  assert.equal(await readSession("", SECRET, ALLOWED), null);
});

test("a short or missing secret never validates", async () => {
  const t = await createSession("owner@example.com", SECRET);
  assert.equal(await readSession(t, "", ALLOWED), null);
  await assert.rejects(createSession("owner@example.com", "short"));
});

const req = (path, cookie) => new Request(`https://site.test${path}`, { headers: cookie ? { cookie } : {} });

test("middleware redirects signed-out visitors and 401s the API", async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ALLOWED_EMAILS = "owner@example.com";
  const page = await middleware(req("/trader/"));
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "https://site.test/trader/login.html");
  const api = await middleware(req("/api/prices?symbols=SPUS"));
  assert.equal(api.status, 401);
  const data = await middleware(req("/trader/data/SPUS.json"));
  assert.equal(data.status, 302);
});

test("middleware lets the login page through and a valid session in", async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ALLOWED_EMAILS = "owner@example.com";
  assert.equal((await middleware(req("/trader/login.html"))).headers.get("x-middleware-next"), "1");
  const cookie = `other=1; lab_session=${await createSession("owner@example.com", SECRET)}`;
  assert.equal(getCookie(req("/", cookie)), cookie.split("lab_session=")[1]);
  assert.equal((await middleware(req("/trader/", cookie))).headers.get("x-middleware-next"), "1");
});

test("middleware fails closed when the server isn't configured", async () => {
  const cookie = `lab_session=${await createSession("owner@example.com", SECRET)}`;
  delete process.env.SESSION_SECRET;
  assert.equal((await middleware(req("/trader/", cookie))).status, 302);
  process.env.SESSION_SECRET = SECRET;
  delete process.env.ALLOWED_EMAILS;
  assert.equal((await middleware(req("/trader/", cookie))).status, 302);
});

test("Google ID tokens are checked for signature, audience, issuer and verified email", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims, key = privateKey) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const good = { iss: "https://accounts.google.com", aud: "client-123", email: "owner@example.com", email_verified: true };
  assert.equal(await verifyGoogleToken(await sign(good), "client-123", keys), "owner@example.com");
  await assert.rejects(verifyGoogleToken(await sign({ ...good, aud: "someone-else" }), "client-123", keys));
  await assert.rejects(verifyGoogleToken(await sign({ ...good, iss: "https://evil.test" }), "client-123", keys));
  await assert.rejects(verifyGoogleToken(await sign({ ...good, email_verified: false }), "client-123", keys));
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifyGoogleToken(await sign(good, other.privateKey), "client-123", keys));
});
