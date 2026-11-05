// POST /api/auth  { credential: <Google ID token> }
// Verifies the Google sign-in token, checks the account is on the allow list
// (ALLOWED_EMAILS) and sets a signed session cookie.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { createSession, sessionCookie, allowedEmails, isAllowed } from "../lib/session.js";

export const config = { runtime: "edge" };

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export async function verifyGoogleToken(credential, clientId, keys = GOOGLE_KEYS) {
  const { payload } = await jwtVerify(credential, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (!payload.email || payload.email_verified !== true) throw new Error("Email not verified");
  return payload.email;
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Only accept sign-ins posted from this site.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Bad origin" }, 403);

  const { GOOGLE_CLIENT_ID, SESSION_SECRET, ALLOWED_EMAILS } = process.env;
  if (!GOOGLE_CLIENT_ID || !SESSION_SECRET || !ALLOWED_EMAILS) return json({ error: "Sign-in is not configured" }, 500);

  let credential;
  try {
    ({ credential } = await request.json());
  } catch (_) {
    return json({ error: "Bad request" }, 400);
  }
  if (!credential) return json({ error: "Missing credential" }, 400);

  let email;
  try {
    email = await verifyGoogleToken(credential, GOOGLE_CLIENT_ID);
  } catch (_) {
    return json({ error: "Google sign-in could not be verified" }, 401);
  }
  if (!isAllowed(email, allowedEmails(ALLOWED_EMAILS))) {
    return json({ error: "This Google account doesn't have access" }, 403);
  }

  const token = await createSession(email.toLowerCase(), SESSION_SECRET);
  return json({ ok: true, email }, 200, { "set-cookie": sessionCookie(token) });
}
