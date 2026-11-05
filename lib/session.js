// Signed session cookies for the private trading lab.
// The cookie holds the signed-in email and an expiry time, signed with
// HMAC-SHA256 using SESSION_SECRET. Works in Edge and Node (Web Crypto).

export const COOKIE = "lab_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(email, secret, now = Date.now()) {
  const payload = b64url(enc.encode(JSON.stringify({ e: email, x: Math.floor(now / 1000) + MAX_AGE })));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

// Returns the email if the token is authentic, unexpired and still allowed.
export async function readSession(token, secret, allowed, now = Date.now()) {
  try {
    if (!token || !token.includes(".")) return null;
    const [payload, sig] = token.split(".");
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!data.x || data.x * 1000 < now) return null;
    if (!isAllowed(data.e, allowed)) return null;
    return data.e;
  } catch (_) {
    return null;
  }
}

export function allowedEmails(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email, allowed) {
  return !!email && allowed.includes(String(email).toLowerCase());
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
