// POST /api/logout: clears the session cookie.
import { sessionCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

export default function handler() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie("", 0) },
  });
}
