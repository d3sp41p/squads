import crypto from "node:crypto";
import { rpcUrl, solPnl, solPrice, syncTrades } from "./chainpnl.js";
import { query } from "./db.js";

// PNL is computed from the wallet's own trades on-chain (see chainpnl.js) and shown in USD at the current SOL price.
const round = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// Local dev without an RPC: stable made-up numbers per wallet so the flows can be tried.
function fakePnl(wallet) {
  const h = crypto.createHash("sha256").update(wallet).digest();
  const d30 = (h.readUInt16BE(0) % 30000) - 4000;
  return { d7: Math.round(d30 * 0.3), d30, all: d30 * 4, sol: null };
}

export async function fetchPnl(wallet) {
  if (!rpcUrl()) {
    if (!process.env.VERCEL) return fakePnl(wallet);
    console.warn("HELIUS_API_KEY is not set; PNL is unavailable");
    return null;
  }
  const [price] = await Promise.all([solPrice(), syncTrades(wallet)]);
  const sol = await solPnl(wallet);
  if (!price) return null;
  return { d7: round(sol.d7 * price), d30: round(sol.d30 * price), all: round(sol.all * price), sol };
}

export async function cachedPnl(wallet) {
  const [row] = await query("select * from pnl where wallet = $1", [wallet]);
  if (!row) return null;
  return {
    d7: row.pnl_7d, d30: row.pnl_30d, all: row.pnl_all, updatedAt: row.updated_at,
    sol: row.sol_30d == null ? null : { d7: row.sol_7d, d30: row.sol_30d, all: row.sol_all },
  };
}

// Refreshes the cached PNL when it is older than maxAgeMs. On failure the old value stays.
export async function refreshPnl(wallet, maxAgeMs = 60 * 60 * 1000) {
  const cached = await cachedPnl(wallet);
  // Rows without SOL figures come from the old provider and are always refreshed.
  const fresh = cached && (cached.sol || !rpcUrl()) && Date.now() - new Date(cached.updatedAt).getTime() < maxAgeMs;
  if (fresh) return cached;
  let next;
  try {
    next = await fetchPnl(wallet);
  } catch (e) {
    console.error(e);
  }
  if (!next) return cached;
  await query(
    `insert into pnl (wallet, pnl_7d, pnl_30d, pnl_all, sol_7d, sol_30d, sol_all, updated_at) values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (wallet) do update set pnl_7d = $2, pnl_30d = $3, pnl_all = $4, sol_7d = $5, sol_30d = $6, sol_all = $7, updated_at = now()`,
    [wallet, next.d7, next.d30, next.all, next.sol?.d7 ?? null, next.sol?.d30 ?? null, next.sol?.all ?? null],
  );
  return { ...next, updatedAt: new Date() };
}
