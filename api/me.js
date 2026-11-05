// GET /api/me: who is signed in (or 401).
import { readSession, getCookie, allowedEmails } from "../lib/session.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const email = await readSession(getCookie(request), process.env.SESSION_SECRET, allowedEmails(process.env.ALLOWED_EMAILS));
  return new Response(JSON.stringify(email ? { email } : { error: "Not signed in" }), {
    status: email ? 200 : 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
