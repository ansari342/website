// Vercel Routing Middleware: keeps the trading lab private.
// Anyone without a valid session cookie for an allowed Google account is sent
// to the sign-in page (pages) or gets a 401 (API calls). It fails closed: if
// the server isn't configured, nobody gets in.

import { readSession, getCookie, allowedEmails } from "./lib/session.js";

export const config = {
  matcher: ["/trader", "/trader/:path*", "/api/prices"],
};

// Equivalent of next() from @vercel/functions: let the request continue.
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });

const PUBLIC = ["/trader/login.html", "/trader/login", "/trader/login.css"];

export default async function middleware(request) {
  const url = new URL(request.url);
  if (PUBLIC.includes(url.pathname)) return next();

  const email = await readSession(
    getCookie(request),
    process.env.SESSION_SECRET,
    allowedEmails(process.env.ALLOWED_EMAILS)
  );
  if (email) return next();

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Sign in required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const login = new URL("/trader/login.html", url);
  return Response.redirect(login, 302);
}
