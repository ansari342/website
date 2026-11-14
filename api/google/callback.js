// GET /api/google/callback?code=...&state=...
// Google sends the visitor back here. Exchange the code for an ID token,
// and give a 30-day session only to an allowed, verified email.
import { STATE_COOKIE, SESSION_COOKIE, MAX_AGE, cookie, getCookie, idTokenClaims, isAllowed, createSession, safeNext } from "../../lib/google-auth.js";

export const config = { runtime: "edge" };

const back = (url, error, extra = []) => new Response(null, {
  status: 302,
  headers: [["location", new URL(`/rattil/login.html?error=${error}`, url).href], ["set-cookie", cookie(STATE_COOKIE, "", 0, "/api/google")], ...extra],
});

export default async function handler(request) {
  const url = new URL(request.url);
  const [state, next] = decodeURIComponent(getCookie(request, STATE_COOKIE) || "").split("|");
  if (!state || state !== url.searchParams.get("state") || !url.searchParams.get("code")) return back(url, "expired");
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret || !process.env.AUTH_SECRET) return back(url, "setup");
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: clientId, client_secret: secret, redirect_uri: new URL("/api/google/callback", url).href, grant_type: "authorization_code" }),
    });
    if (!res.ok) return back(url, "google");
    const claims = idTokenClaims((await res.json()).id_token, clientId);
    if (!isAllowed(claims.email)) return back(url, "notallowed");
    return new Response(null, {
      status: 302,
      headers: [
        ["location", new URL(safeNext(next), url).href],
        ["set-cookie", cookie(STATE_COOKIE, "", 0, "/api/google")],
        ["set-cookie", cookie(SESSION_COOKIE, await createSession(claims.email), MAX_AGE)],
      ],
    });
  } catch {
    return back(url, "google");
  }
}
