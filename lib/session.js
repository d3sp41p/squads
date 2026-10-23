import crypto from "node:crypto";

const COOKIE = "enlist_session";
const MAX_AGE = 30 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.VERCEL) throw new Error("SESSION_SECRET is not set");
  return "local-dev-only-secret";
}

const mac = data => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

function cookie(value, maxAge, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(wallet, request) {
  const body = Buffer.from(JSON.stringify({ w: wallet, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  return cookie(`${body}.${mac(body)}`, MAX_AGE, request);
}

export function clearCookie(request) {
  return cookie("", 0, request);
}

// Returns the signed-in wallet address, or null.
export function sessionWallet(request) {
  const raw = (request.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!body || !sig) return null;
  const expected = mac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
    return exp > Date.now() ? w : null;
  } catch {
    return null;
  }
}
