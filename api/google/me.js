// GET /api/google/me: who is signed in to Rattil, if anyone.
import { requestEmail } from "../../lib/google-auth.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  return new Response(JSON.stringify({ email: await requestEmail(request) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
