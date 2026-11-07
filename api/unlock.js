// POST /api/unlock  { code: "12345" }
// The right passcode sets a 30-day cookie. A wrong one waits a moment before
// answering, to slow down guessing.
import { checkPasscode, createSession, sessionCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export const WRONG_DELAY_MS = 800;

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Bad origin" }, 403);
  let code;
  try {
    ({ code } = await request.json());
  } catch (_) {
    return json({ error: "Bad request" }, 400);
  }
  if (!checkPasscode(code)) {
    await new Promise((r) => setTimeout(r, WRONG_DELAY_MS));
    return json({ ok: false }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(await createSession()) });
}
