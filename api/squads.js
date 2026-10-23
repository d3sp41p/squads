import { query, transaction } from "../lib/db.js";
import { handle, HttpError, json, readJson } from "../lib/http.js";
import { cachedPnl } from "../lib/pnl.js";
import { sessionWallet } from "../lib/session.js";
import {
  MAX_MEMBERS, cleanSquadFields, cleanWallets, getSquad, imageId, listSquads, memberCount, qualifies, saveImage, short, squadOf,
} from "../lib/squads.js";

function requireWallet(request) {
  const w = sessionWallet(request);
  if (!w) throw new HttpError(401, "Connect your wallet first");
  return w;
}

async function ensureFree(q, wallet, who = "You are") {
  if (await squadOf(q, wallet)) throw new HttpError(409, `${who} already in a squad on Enlist. One squad per person.`);
}

// GET /api/squads → every listed squad with members
// GET /api/squads?invite=<id> → the squad's Pumpfun invite, only for someone who qualifies
export const GET = handle(async request => {
  const inviteFor = new URL(request.url).searchParams.get("invite");
  if (!inviteFor) {
    return json({ squads: await listSquads() }, 200, { "cache-control": "no-store" });
  }
  const wallet = requireWallet(request);
  const s = await getSquad(query, inviteFor);
  const mySquad = await squadOf(query, wallet);
  if (mySquad !== s.id) {
    if (s.status === "entered") throw new HttpError(403, "This squad already submitted its Squad Entry");
    if ((await memberCount(query, s.id)) >= MAX_MEMBERS) throw new HttpError(403, "This squad is full");
    if (mySquad) throw new HttpError(403, "You are already in another squad. One squad per person.");
    if (!qualifies(s, await cachedPnl(wallet))) throw new HttpError(403, "Your PNL is below this squad's entry bar");
  }
  return json({ invite: s.invite });
});

export const POST = handle(async request => {
  const wallet = requireWallet(request);
  const b = await readJson(request);

  switch (b.action) {
    case "create":
    case "import": {
      const f = cleanSquadFields(b);
      const imported = b.action === "import";
      const others = imported ? cleanWallets(b.wallets, wallet) : [];
      const status = imported && b.status === "entered" ? "entered" : "recruiting";
      const id = await transaction(async q => {
        await ensureFree(q, wallet);
        for (const w of others) await ensureFree(q, w, short(w) + " is");
        const photo = await saveImage(q, b.photo);
        const banner = await saveImage(q, b.banner);
        const [row] = await q(
          `insert into squads (name, photo_url, banner_url, region, min_pnl_usd, pnl_period, description, invite, origin, status, creator_wallet)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
          [f.name, photo, banner, f.region, f.minPnl, f.period, f.desc, f.invite, imported ? "pumpfun" : "made_here", status, wallet],
        );
        await q("insert into squad_members (squad_id, wallet, is_creator) values ($1, $2, true)", [row.id, wallet]);
        for (const w of others) await q("insert into squad_members (squad_id, wallet) values ($1, $2)", [row.id, w]);
        return row.id;
      });
      return json({ id });
    }

    case "lock": {
      const s = await getSquad(query, b.id);
      if (s.creator_wallet !== wallet) throw new HttpError(403, "Only the squad creator can do this");
      await query("update squads set status = 'entered' where id = $1", [s.id]);
      return json({ ok: true });
    }

    // A trader joined in the Pumpfun app and adds themself to the listing here.
    case "join": {
      // Read outside the transaction: the pool has one connection, so a nested query would wait forever.
      const pnl = await cachedPnl(wallet);
      await transaction(async q => {
        const s = await getSquad(q, b.id, true);
        if (s.status === "entered") throw new HttpError(403, "This squad already submitted its Squad Entry");
        if ((await memberCount(q, s.id)) >= MAX_MEMBERS) throw new HttpError(403, "This squad is full");
        await ensureFree(q, wallet);
        if (!qualifies(s, pnl)) throw new HttpError(403, "Your PNL is below this squad's entry bar");
        await q("insert into squad_members (squad_id, wallet) values ($1, $2)", [s.id, wallet]);
      });
      return json({ ok: true });
    }

    // Leave a squad yourself, or (creator) take someone off the list.
    case "remove": {
      const s = await getSquad(query, b.id);
      const target = b.wallet ? String(b.wallet) : wallet;
      if (target !== wallet && s.creator_wallet !== wallet) throw new HttpError(403, "Only the squad creator can do this");
      if (target === s.creator_wallet) throw new HttpError(400, "The creator can't leave. Delete the listing instead.");
      await query("delete from squad_members where squad_id = $1 and wallet = $2", [s.id, target]);
      return json({ ok: true });
    }

    case "delete": {
      const s = await getSquad(query, b.id);
      if (s.creator_wallet !== wallet) throw new HttpError(403, "Only the squad creator can do this");
      await transaction(async q => {
        await q("delete from squads where id = $1", [s.id]);
        for (const img of [imageId(s.photo_url), imageId(s.banner_url)]) {
          if (img) await q("delete from images where id = $1", [img]);
        }
      });
      return json({ ok: true });
    }

    default:
      throw new HttpError(400, "Unknown action");
  }
});
