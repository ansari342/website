// Google sign-in checks shared by the middleware and the API.
import { createRemoteJWKSet, jwtVerify } from "jose";

// Only these Google accounts can open the trading lab. Everyone else sees
// "Coming soon". ALLOWED_EMAILS (comma-separated) overrides this list.
export const DEFAULT_ALLOWED = ["ansari342@gmail.com"];

export function allowedList(value = process.env.ALLOWED_EMAILS) {
  const list = (value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED;
}

export function isAllowed(email, list = allowedList()) {
  return !!email && list.includes(String(email).toLowerCase());
}

// The site's Google OAuth client ID (public, not a secret). GOOGLE_CLIENT_ID overrides it.
export const DEFAULT_CLIENT_ID = "1064382510894-dk1atqfsjqkq3kbmih7fccso0ijd116.apps.googleusercontent.com";

export function clientId(value = process.env.GOOGLE_CLIENT_ID) {
  return value || DEFAULT_CLIENT_ID;
}

let keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
// Tests swap in local keys.
export function setGoogleKeys(k) {
  keys = k;
}

// Verifies a Google ID token (signature, audience, issuer, expiry, verified
// email) and returns the email address.
export async function verifyGoogleToken(credential, clientId) {
  if (!credential || !clientId) throw new Error("Missing token or client ID");
  const { payload } = await jwtVerify(credential, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (!payload.email || payload.email_verified !== true) throw new Error("Email not verified");
  return String(payload.email).toLowerCase();
}
