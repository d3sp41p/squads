import crypto from "node:crypto";
import { query } from "../lib/db.js";
import { handle, HttpError, json, readJson } from "../lib/http.js";
import { cachedPnl, debugPnl, refreshPnl } from "../lib/pnl.js";
import { clearCookie, sessionCookie, sessionWallet } from "../lib/session.js";
import { isAddress, signInMessage, verifySignature } from "../lib/solana.js";
import { squadOf } from "../lib/squads.js";

const NONCE_TTL = "10 minutes";

async function me(wallet, pnl) {
  pnl ??= await cachedPnl(wallet);
  return {
    wallet,
    pnl: pnl ? { d7: pnl.d7, d30: pnl.d30, all: pnl.all } : null,
    pnlUpdatedAt: pnl?.updatedAt ?? null,
    squadId: await squadOf(query, wallet),
  };
}

// GET /api/auth → who is signed in
export const GET = handle(async request => {
  const wallet = sessionWallet(request);
  // TEMPORARY: /api/auth?debug=<address> → raw PNL data, for signed-in users only. Remove after the check.
  const debug = new URL(request.url).searchParams.get("debug");
  if (debug) {
    if (!wallet) throw new HttpError(401, "Sign in first");
    if (!isAddress(debug)) throw new HttpError(400, "Not a wallet address");
    return json(await debugPnl(debug));
  }
  return json(wallet ? await me(wallet) : { wallet: null });
});

// POST /api/auth?action=nonce | verify | logout
export const POST = handle(async request => {
  const action = new URL(request.url).searchParams.get("action");

  if (action === "nonce") {
    const nonce = crypto.randomBytes(16).toString("hex");
    await query(`delete from nonces where created_at < now() - interval '${NONCE_TTL}'`);
    await query("insert into nonces (nonce) values ($1)", [nonce]);
    return json({ nonce, message: signInMessage(nonce) });
  }

  if (action === "verify") {
    const { wallet, signature, nonce } = await readJson(request, 10_000);
    if (!isAddress(wallet)) throw new HttpError(400, "That isn't a Solana wallet address");
    const used = await query(
      `delete from nonces where nonce = $1 and created_at > now() - interval '${NONCE_TTL}' returning nonce`,
      [String(nonce || "")],
    );
    if (!used.length) throw new HttpError(400, "Sign-in expired. Try again.");
    if (!verifySignature(signInMessage(nonce), String(signature || ""), wallet)) {
      throw new HttpError(401, "The signature doesn't match this wallet");
    }
    await query(
      `insert into wallets (address) values ($1)
       on conflict (address) do update set last_signature_at = now()`,
      [wallet],
    );
    const pnl = await refreshPnl(wallet);
    return json(await me(wallet, pnl), 200, { "set-cookie": sessionCookie(wallet, request) });
  }

  if (action === "logout") return json({ wallet: null }, 200, { "set-cookie": clearCookie(request) });

  throw new HttpError(400, "Unknown action");
});
