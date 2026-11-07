// Vercel Routing Middleware: keeps the trading lab private.
// Only an allowed Google account gets in. Everyone else is sent to the
// "Coming soon" page (or gets a 401 from the price API).

import { readSession, getCookie } from "./lib/session.js";

export const config = {
  matcher: ["/trading", "/trading/:path*", "/api/prices"],
};

// Equivalent of next() from @vercel/functions: let the request continue.
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });

const PUBLIC = ["/trading/login.html", "/trading/login", "/trading/login.css"];

export default async function middleware(request) {
  const url = new URL(request.url);
  if (PUBLIC.includes(url.pathname)) return next();

  if (await readSession(getCookie(request))) return next();

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Sign in required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return Response.redirect(new URL("/trading/login.html", url), 302);
}
