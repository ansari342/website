// Passcode gate for the trading lab.
//
// The passcode is TRADING_PASSCODE (set it in Vercel to change it without
// touching code), or "12345" if that isn't set. After the right code is
// entered, the browser gets a cookie that lasts 30 days. The cookie is signed
// with the passcode itself, so changing the passcode signs everyone out.

export const COOKIE = "lab_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const DEFAULT_PASSCODE = "12345";

export function passcode(value = process.env.TRADING_PASSCODE) {
  return value && value.trim() ? value.trim() : DEFAULT_PASSCODE;
}

const enc = new TextEncoder();
const b64url = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function sign(message, code) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`trading-lab:${code}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// Compare without leaking how many characters matched.
function sameText(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function checkPasscode(input, code = passcode()) {
  return typeof input === "string" && sameText(input.trim(), code);
}

export async function createSession(code = passcode(), now = Date.now()) {
  const exp = String(Math.floor(now / 1000) + MAX_AGE);
  return `${exp}.${await sign(exp, code)}`;
}

export async function isUnlocked(token, code = passcode(), now = Date.now()) {
  try {
    if (!token || !token.includes(".")) return false;
    const [exp, sig] = token.split(".");
    if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
    return sameText(sig, await sign(exp, code));
  } catch (_) {
    return false;
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
