// Vercel Routing Middleware.
// - The trading lab is behind a passcode: anyone without the unlock cookie is
//   sent to its "Coming soon" page (or gets a 401 from the price API).
// - Rattil is behind Google sign-in, for allowlisted accounts only
//   (lib/google-auth.js): others are sent to its sign-in page, or get a 401
//   from its API.

import { isUnlocked, getCookie } from "./lib/session.js";
import { requestEmail } from "./lib/google-auth.js";

export const config = {
  matcher: ["/trading", "/trading/:path*", "/api/prices", "/rattil", "/rattil/:path*", "/api/rattil-scenes"],
};

// Equivalent of next() from @vercel/functions: let the request continue.
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });
const unauthorized = (error) => new Response(JSON.stringify({ error }), { status: 401, headers: { "content-type": "application/json" } });

const PUBLIC = ["/trading/login.html", "/trading/login", "/trading/login.css", "/rattil/login.html", "/rattil/login", "/rattil/rattil.css"];

export default async function middleware(request) {
  const url = new URL(request.url);
  if (PUBLIC.includes(url.pathname)) return next();

  if (url.pathname.startsWith("/rattil") || url.pathname === "/api/rattil-scenes") {
    if (await requestEmail(request)) return next();
    if (url.pathname.startsWith("/api/")) return unauthorized("Sign in required");
    return Response.redirect(new URL("/rattil/login.html", url), 302);
  }

  if (await isUnlocked(getCookie(request))) return next();
  if (url.pathname.startsWith("/api/")) return unauthorized("Passcode required");
  return Response.redirect(new URL("/trading/login.html", url), 302);
}
