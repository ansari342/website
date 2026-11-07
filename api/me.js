// GET /api/me: whether this browser has unlocked the trading lab.
import { isUnlocked, getCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const ok = await isUnlocked(getCookie(request));
  return new Response(JSON.stringify({ unlocked: ok }), {
    status: ok ? 200 : 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
