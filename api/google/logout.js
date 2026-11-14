// GET /api/google/logout: ends the Rattil session.
import { SESSION_COOKIE, cookie } from "../../lib/google-auth.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  return new Response(null, { status: 302, headers: { location: new URL("/rattil/", request.url).href, "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
}
