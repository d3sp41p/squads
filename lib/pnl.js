import crypto from "node:crypto";
import { query } from "./db.js";

// PNL comes from Solana Tracker's Data API (PnL V2), never from Pumpfun.
// all-time = wallet summary total PNL; 7D and 30D = realized PNL over that window.
const BASE = "https://data.solanatracker.io/v2/pnl/wallets/";

async function get(url, key, retry = true) {
  const r = await fetch(url, { headers: { "x-api-key": key, accept: "application/json" } });
  if (r.status === 429 && retry) {
    await new Promise(res => setTimeout(res, 1200));
    return get(url, key, false);
  }
  if (!r.ok) throw new Error(`PNL API ${r.status} for ${url}`);
  return r.json();
}

const num = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

async function fetchSolanaTracker(wallet, key) {
  const w = encodeURIComponent(wallet);
  const [summary, p7, p30] = await Promise.all([
    get(BASE + w, key),
    get(`${BASE}${w}/performance?period=7d&currency=usd`, key),
    get(`${BASE}${w}/performance?period=30d&currency=usd`, key),
  ]);
  return { d7: num(p7?.totals?.realizedPnl), d30: num(p30?.totals?.realizedPnl), all: num(summary?.summary?.pnl?.total) };
}

// Local dev without a key: stable made-up numbers per wallet so the flows can be tried.
function fakePnl(wallet) {
  const h = crypto.createHash("sha256").update(wallet).digest();
  const d30 = (h.readUInt16BE(0) % 30000) - 4000;
  return { d7: Math.round(d30 * 0.3), d30, all: d30 * 4 };
}

export async function fetchPnl(wallet) {
  const key = process.env.SOLANATRACKER_API_KEY;
  if (key) return fetchSolanaTracker(wallet, key);
  if (!process.env.VERCEL) return fakePnl(wallet);
  console.warn("SOLANATRACKER_API_KEY is not set; PNL is unavailable");
  return null;
}

export async function cachedPnl(wallet) {
  const [row] = await query("select pnl_7d, pnl_30d, pnl_all, updated_at from pnl where wallet = $1", [wallet]);
  return row ? { d7: row.pnl_7d, d30: row.pnl_30d, all: row.pnl_all, updatedAt: row.updated_at } : null;
}

// Refreshes the cached PNL when it is older than maxAgeMs. On API failure the old value stays.
export async function refreshPnl(wallet, maxAgeMs = 60 * 60 * 1000) {
  const cached = await cachedPnl(wallet);
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < maxAgeMs) return cached;
  let fresh;
  try {
    fresh = await fetchPnl(wallet);
  } catch (e) {
    console.error(e);
  }
  if (!fresh) return cached;
  await query(
    `insert into pnl (wallet, pnl_7d, pnl_30d, pnl_all, updated_at) values ($1, $2, $3, $4, now())
     on conflict (wallet) do update set pnl_7d = $2, pnl_30d = $3, pnl_all = $4, updated_at = now()`,
    [wallet, fresh.d7, fresh.d30, fresh.all],
  );
  return { ...fresh, updatedAt: new Date() };
}
