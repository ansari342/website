// Google sign-in for Rattil. Only emails on the allowlist get a session.
//
// Settings (Vercel environment variables):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  an OAuth client from Google Cloud
//   AUTH_SECRET                             any long random string; signs the session cookie
//   ALLOWED_EMAILS                          comma-separated; defaults to ansari342@gmail.com
//
// Without AUTH_SECRET nobody can sign in (it fails closed).

export const SESSION_COOKIE = "rattil_session";
export const STATE_COOKIE = "rattil_oauth";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const DEFAULT_ALLOWED = "ansari342@gmail.com";

const enc = new TextEncoder();
const b64url = (bytes) => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64url = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

export function allowedEmails(value = process.env.ALLOWED_EMAILS) {
  return (value && value.trim() ? value : DEFAULT_ALLOWED).split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export const isAllowed = (email, list = allowedEmails()) => !!email && list.includes(String(email).toLowerCase());

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`rattil:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
function sameText(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function createSession(email, secret = process.env.AUTH_SECRET, now = Date.now()) {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const body = b64url(enc.encode(JSON.stringify({ email: email.toLowerCase(), exp: Math.floor(now / 1000) + MAX_AGE })));
  return `${body}.${await hmac(body, secret)}`;
}

// The signed-in, allowed email, or null.
export async function sessionEmail(token, secret = process.env.AUTH_SECRET, now = Date.now(), list = allowedEmails()) {
  try {
    if (!secret || !token || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    if (!sameText(sig, await hmac(body, secret))) return null;
    const { email, exp } = JSON.parse(fromB64url(body));
    if (!exp || exp * 1000 < now || !isAllowed(email, list)) return null;
    return email;
  } catch { return null; }
}

export function getCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
export const cookie = (name, value, maxAge, path = "/") => `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const requestEmail = (request) => sessionEmail(getCookie(request, SESSION_COOKIE));

// Read the claims of an ID token received directly from Google's token
// endpoint over TLS (OpenID Connect allows skipping the signature check then),
// and check who it was issued to and by.
export function idTokenClaims(idToken, clientId, now = Date.now()) {
  const c = JSON.parse(fromB64url(idToken.split(".")[1]));
  if (c.aud !== clientId) throw new Error("token is for another app");
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("token not from Google");
  if (!c.exp || c.exp * 1000 < now) throw new Error("token expired");
  if (c.email_verified !== true && c.email_verified !== "true") throw new Error("email not verified");
  return c;
}

// Only same-site paths as the place to return to after signing in.
export const safeNext = (next) => (typeof next === "string" && /^\/[a-zA-Z0-9/_\-.]*$/.test(next) && !next.startsWith("//") ? next : "/rattil/");
