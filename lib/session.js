// Who is signed in to the trading lab.
//
// The lab_session cookie holds one of two things:
// - A Google ID token (the default). Google signs it and it lasts about an
//   hour; the sign-in page renews it automatically with one click or none.
// - If SESSION_SECRET is set, our own HMAC-signed token that lasts 7 days.
// Either way the email must be on the allowed list.

import { verifyGoogleToken, isAllowed, allowedList } from "./google.js";

export const COOKIE = "lab_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days (signed sessions)
export const GOOGLE_MAX_AGE = 60 * 60; // 1 hour (Google tokens)

const enc = new TextEncoder();
const b64url = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (str) => {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function key(secret) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(email, secret, now = Date.now()) {
  const payload = b64url(enc.encode(JSON.stringify({ e: email, x: Math.floor(now / 1000) + MAX_AGE })));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return `s.${payload}.${b64url(sig)}`;
}

async function readSigned(token, secret, now) {
  const [, payload, sig] = token.split(".");
  const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(payload));
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  return data.x && data.x * 1000 >= now ? data.e : null;
}

// Returns the signed-in email if the cookie is valid and the email is allowed.
export async function readSession(token, { clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.SESSION_SECRET, allowed = allowedList(), now = Date.now() } = {}) {
  try {
    if (!token) return null;
    const email = token.startsWith("s.") ? (secret ? await readSigned(token, secret, now) : null) : await verifyGoogleToken(token, clientId);
    return email && isAllowed(email, allowed) ? email : null;
  } catch (_) {
    return null;
  }
}

export function getCookie(request, name = COOKIE) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(value, maxAge = MAX_AGE) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
