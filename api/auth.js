// POST /api/auth  { credential: <Google ID token> }
// Checks the Google sign-in. An allowed account gets a session cookie and
// { allowed: true }. Any other Google account gets { allowed: false } and the
// page shows "Coming soon".

import { verifyGoogleToken, isAllowed, clientId } from "../lib/google.js";
import { createSession, sessionCookie, GOOGLE_MAX_AGE } from "../lib/session.js";

export const config = { runtime: "edge" };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Only accept sign-ins posted from this site.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Bad origin" }, 403);

  const { SESSION_SECRET } = process.env;

  let credential;
  try {
    ({ credential } = await request.json());
  } catch (_) {
    return json({ error: "Bad request" }, 400);
  }

  let email;
  try {
    email = await verifyGoogleToken(credential, clientId());
  } catch (_) {
    return json({ error: "Google sign-in could not be verified" }, 401);
  }
  if (!isAllowed(email)) return json({ allowed: false });

  const cookie = SESSION_SECRET && SESSION_SECRET.length >= 32
    ? sessionCookie(await createSession(email, SESSION_SECRET))
    : sessionCookie(credential, GOOGLE_MAX_AGE);
  return json({ allowed: true }, 200, { "set-cookie": cookie });
}
