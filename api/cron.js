import { query } from "../lib/db.js";
import { handle, HttpError, json } from "../lib/http.js";
import { refreshPnl } from "../lib/pnl.js";

// Called by Vercel Cron (see vercel.json). Refreshes the stalest PNL of verified squad members.
// The free Solana Tracker plan allows 3 requests a second and each wallet takes 3, so go one wallet at a time.
export const GET = handle(async request => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");
  const batch = Number(process.env.PNL_REFRESH_BATCH) || 40;
  const rows = await query(
    `select m.wallet from squad_members m
     join wallets w on w.address = m.wallet
     left join pnl p on p.wallet = m.wallet
     order by p.updated_at asc nulls first
     limit $1`,
    [batch],
  );
  const started = Date.now();
  let done = 0;
  for (const { wallet } of rows) {
    if (Date.now() - started > 50_000) break;
    await refreshPnl(wallet, 5 * 60 * 1000);
    done++;
    await new Promise(r => setTimeout(r, 1000));
  }
  return json({ refreshed: done, of: rows.length });
});
