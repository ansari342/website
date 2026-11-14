// GET /api/google/login?next=/rattil/
// Sends the visitor to Google's sign-in, remembering a random state (to check
// on the way back) and where to return to.
import { STATE_COOKIE, cookie, safeNext } from "../../lib/google-auth.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  const url = new URL(request.url);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.AUTH_SECRET) return Response.redirect(new URL("/rattil/login.html?error=setup", url), 302);
  const state = crypto.randomUUID();
  const next = safeNext(url.searchParams.get("next"));
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: new URL("/api/google/callback", url).href,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { location: google.href, "set-cookie": cookie(STATE_COOKIE, encodeURIComponent(`${state}|${next}`), 600, "/api/google") },
  });
}
