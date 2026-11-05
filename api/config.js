// GET /api/config: public sign-in settings for the login page.
// The Google client ID is not a secret; it identifies this site to Google.

export const config = { runtime: "edge" };

export default function handler() {
  return new Response(JSON.stringify({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
