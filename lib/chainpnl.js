// PNL straight from the chain: the SOL a wallet gained or spent in its trades, fees included.
// A trade is a successful transaction that changed both the wallet's SOL (native + wSOL) and one of its other tokens.
// Deposits and withdrawals (SOL moving with no token change) don't count, and tokens still held count at zero.
import { query } from "./db.js";

const WSOL = "So11111111111111111111111111111111111111112";
const PAGE = 1000; // getTransactionsForAddress max in full mode
const MAX_PAGES = 8; // per refresh; a longer history is finished on the next refresh
const DAY = 86400;

export function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
  return process.env.SOLANA_RPC_URL || null;
}

async function rpc(url, method, params) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
      .catch(e => (i < 7 ? { status: 429 } : Promise.reject(e))); // network blip: retry like a rate limit
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1000 * (i + 1))); continue; }
    const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
    if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
    return j.result;
  }
  throw new Error(`${method}: rate limited`);
}

// SOL change for `wallet` in one getTransaction-format result, or null when it isn't a trade.
export function tradeDelta(tx, wallet) {
  if (!tx?.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map(k => (typeof k === "string" ? k : k.pubkey));
  const loaded = tx.meta.loadedAddresses ? [...(tx.meta.loadedAddresses.writable || []), ...(tx.meta.loadedAddresses.readonly || [])] : [];
  const i = [...keys, ...loaded].indexOf(wallet);
  const native = i >= 0 ? (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9 : 0;
  const sum = list => {
    const m = {};
    for (const b of list || []) if (b.owner === wallet) m[b.mint] = (m[b.mint] || 0) + Number(b.uiTokenAmount.uiAmountString || 0);
    return m;
  };
  const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
  let wsol = 0, token = false;
  for (const mint of new Set([...Object.keys(pre), ...Object.keys(post)])) {
    const d = (post[mint] || 0) - (pre[mint] || 0);
    if (mint === WSOL) wsol += d;
    else if (d !== 0) token = true;
  }
  const sol = native + wsol;
  return token && sol !== 0 ? sol : null;
}

// Helius getTransactionsForAddress: up to 1000 full transactions a call, newest first.
async function* pagesHelius(url, wallet, filters) {
  let paginationToken;
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await rpc(url, "getTransactionsForAddress", [wallet, {
      transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1,
      sortOrder: "desc", limit: PAGE, paginationToken,
      filters: { status: "succeeded", tokenAccounts: "balanceChanged", ...filters },
    }]);
    yield res.data.map(t => ({ ...t, signature: t.transaction.signatures[0] }));
    if (!res.paginationToken) return;
    paginationToken = res.paginationToken;
  }
  yield null; // ran out of pages before the end
}

// Any other RPC: signatures, then each transaction (slow; fine for local tests).
async function* pagesStandard(url, wallet, { blockTime }) {
  let before;
  for (let p = 0; p < MAX_PAGES; p++) {
    let sigs = await rpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, before }]);
    const done = sigs.length < 1000;
    before = sigs.at(-1)?.signature;
    sigs = sigs.filter(s => !s.err && (!blockTime?.gt || s.blockTime > blockTime.gt) && (!blockTime?.lt || s.blockTime < blockTime.lt));
    const txs = [];
    const n = Number(process.env.RPC_CONCURRENCY) || 5;
    for (let i = 0; i < sigs.length; i += n) {
      txs.push(...await Promise.all(sigs.slice(i, i + n).map(async s => {
        const tx = await rpc(url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
        return tx && { ...tx, signature: s.signature };
      })));
    }
    yield txs.filter(Boolean);
    if (done || (blockTime?.gt && sigs.length === 0)) return;
  }
  yield null;
}

async function store(wallet, txs) {
  for (const tx of txs) {
    const sol = tradeDelta(tx, wallet);
    if (sol === null) continue;
    await query(
      "insert into wallet_trades (signature, wallet, block_time, sol_delta) values ($1, $2, to_timestamp($3), $4) on conflict do nothing",
      [tx.signature, wallet, tx.blockTime, sol],
    );
  }
}

// Pulls new trades since the last sync, then keeps backfilling older history until it's complete.
export async function syncTrades(wallet) {
  const url = rpcUrl();
  if (!url) return false;
  const pages = process.env.HELIUS_API_KEY ? pagesHelius : pagesStandard;
  const [st] = await query("select extract(epoch from newest)::bigint as newest, extract(epoch from oldest)::bigint as oldest, complete from wallet_sync where wallet = $1", [wallet]);
  const now = Math.floor(Date.now() / 1000);
  let newest = st?.newest ? Number(st.newest) : null, oldest = st?.oldest ? Number(st.oldest) : null, complete = st?.complete ?? false;

  // 1. newer than what we have (or everything, first time)
  const fresh = newest ? { blockTime: { gt: newest } } : {};
  let ranOut = false;
  for await (const txs of pages(url, wallet, fresh)) {
    if (txs === null) { ranOut = true; break; }
    await store(wallet, txs);
    for (const t of txs) {
      if (!newest || t.blockTime > newest) newest = t.blockTime;
      if (!oldest || t.blockTime < oldest) oldest = t.blockTime;
    }
  }
  if (!st) complete = !ranOut;
  // 2. older history left over from an earlier capped sync
  else if (!complete && oldest) {
    complete = true;
    for await (const txs of pages(url, wallet, { blockTime: { lt: oldest } })) {
      if (txs === null) { complete = false; break; }
      await store(wallet, txs);
      for (const t of txs) if (t.blockTime < oldest) oldest = t.blockTime;
    }
  }
  newest ??= now;
  await query(
    `insert into wallet_sync (wallet, newest, oldest, complete, synced_at) values ($1, to_timestamp($2), to_timestamp($3), $4, now())
     on conflict (wallet) do update set newest = to_timestamp($2), oldest = to_timestamp($3), complete = $4, synced_at = now()`,
    [wallet, newest, oldest ?? newest, complete],
  );
  return true;
}

export async function solPnl(wallet) {
  const now = Math.floor(Date.now() / 1000);
  const [r] = await query(
    `select coalesce(sum(sol_delta) filter (where block_time >= to_timestamp($2)), 0) as d7,
            coalesce(sum(sol_delta) filter (where block_time >= to_timestamp($3)), 0) as d30,
            coalesce(sum(sol_delta), 0) as all
     from wallet_trades where wallet = $1`,
    [wallet, now - 7 * DAY, now - 30 * DAY],
  );
  return { d7: Number(r.d7), d30: Number(r.d30), all: Number(r.all) };
}

let priceCache = { at: 0, usd: null };
export async function solPrice() {
  if (Date.now() - priceCache.at < 5 * 60 * 1000 && priceCache.usd) return priceCache.usd;
  const sources = [
    async () => (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")).json()).solana.usd,
    async () => Number((await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`)).json())[WSOL].usdPrice),
  ];
  for (const s of sources) {
    try {
      const usd = await s();
      if (usd > 0) { priceCache = { at: Date.now(), usd }; return usd; }
    } catch {}
  }
  return priceCache.usd;
}
