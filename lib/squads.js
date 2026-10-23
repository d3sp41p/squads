import crypto from "node:crypto";
import { query } from "./db.js";
import { HttpError } from "./http.js";
import { isAddress } from "./solana.js";

export const MAX_MEMBERS = 20;
export const REGIONS = ["Asia", "USA", "EU", "Africa"];
const PERIOD_TO_DB = { d7: "7d", d30: "30d", all: "all" };
const PERIOD_FROM_DB = { "7d": "d7", "30d": "d30", all: "all" };
const MAX_IMAGE_BYTES = 1_500_000;

// Invites must be a Pumpfun link or a bare code, so a listing can't send people to a look-alike site.
const INVITE_HOSTS = ["pump.fun"];

export const short = w => w.slice(0, 4) + "…" + w.slice(-4);

export function cleanInvite(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new HttpError(400, "Add the invite link or code from the Pumpfun app");
  if (s.length <= 200 && /^https?:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      u = null;
    }
    if (u && u.protocol === "https:" && INVITE_HOSTS.some(h => u.hostname === h || u.hostname.endsWith("." + h))) return u.href;
  } else if (/^[A-Za-z0-9_-]{3,64}$/.test(s)) {
    return s;
  }
  throw new HttpError(400, "Paste the invite link from the Pumpfun app (a pump.fun link) or just the invite code");
}

export function cleanSquadFields(b) {
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 28) throw new HttpError(400, "Squad name must be 1 to 28 characters");
  if (!REGIONS.includes(b.region)) throw new HttpError(400, "Pick a region");
  const period = PERIOD_TO_DB[b.period];
  if (!period) throw new HttpError(400, "Pick the PNL period");
  const minPnl = Math.round(Number(b.minPnl) || 0);
  if (minPnl < 0 || minPnl > 100_000_000) throw new HttpError(400, "Minimum PNL must be between $0 and $100M");
  const desc = String(b.desc || "").trim().slice(0, 90);
  return { name, region: b.region, period, minPnl, desc, invite: cleanInvite(b.invite) };
}

export function cleanWallets(list, creator) {
  const ws = [...new Set((Array.isArray(list) ? list : []).map(w => String(w).trim()).filter(Boolean))].filter(w => w !== creator);
  const bad = ws.find(w => !isAddress(w));
  if (bad) throw new HttpError(400, `${bad.length > 12 ? short(bad) : bad} isn't a Solana address`);
  if (ws.length + 1 > MAX_MEMBERS) throw new HttpError(400, `A squad has at most ${MAX_MEMBERS} members, including you`);
  return ws;
}

const MAGIC = {
  "image/png": b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": b => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};

// Takes a data: URL from the browser (already resized there), stores it, returns its public URL.
export async function saveImage(q, dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new HttpError(400, "Images must be PNG, JPEG or WebP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES || !MAGIC[m[1]](bytes)) throw new HttpError(400, "That image couldn't be used, try another one");
  const id = crypto.randomBytes(12).toString("base64url");
  await q("insert into images (id, mime, data) values ($1, $2, $3)", [id, m[1], bytes]);
  return `/api/img?id=${id}`;
}

export const imageId = url => (url && /[?&]id=([\w-]+)/.exec(url)?.[1]) || null;

// "Any positive PNL" squads (min 0) still let people in when their PNL couldn't be loaded.
export function qualifies(squad, pnl) {
  const v = pnl?.[PERIOD_FROM_DB[squad.pnl_period]];
  if (!squad.min_pnl_usd) return typeof v !== "number" || v >= 0;
  return typeof v === "number" && v >= squad.min_pnl_usd;
}

export async function listSquads() {
  const [squads, members] = await Promise.all([
    query("select * from squads order by created_at desc"),
    query(`select m.squad_id, m.wallet, m.is_creator, m.joined_at, (w.address is not null) as verified,
             p.pnl_7d, p.pnl_30d, p.pnl_all
           from squad_members m
           left join wallets w on w.address = m.wallet
           left join pnl p on p.wallet = m.wallet
           order by m.is_creator desc, m.joined_at`),
  ]);
  const bySquad = new Map();
  for (const m of members) {
    if (!bySquad.has(m.squad_id)) bySquad.set(m.squad_id, []);
    bySquad.get(m.squad_id).push({
      w: m.wallet,
      creator: m.is_creator,
      v: m.verified,
      d7: m.verified ? m.pnl_7d : null,
      d30: m.verified ? m.pnl_30d : null,
      all: m.verified ? m.pnl_all : null,
    });
  }
  return squads.map(s => {
    const list = bySquad.get(s.id) || [];
    return {
      id: s.id,
      name: s.name,
      region: s.region,
      req: { p: PERIOD_FROM_DB[s.pnl_period], v: s.min_pnl_usd },
      desc: s.description,
      img: s.photo_url,
      banner: s.banner_url,
      origin: s.origin === "pumpfun" ? "pf" : "here",
      entered: s.status === "entered",
      creator: s.creator_wallet,
      created: new Date(s.created_at).getTime(),
      members: list.length,
      verified: list.filter(m => m.v).length,
      list,
    };
  });
}

export async function getSquad(q, id, forUpdate = false) {
  const [s] = await q(`select * from squads where id = $1${forUpdate ? " for update" : ""}`, [Number(id) || 0]);
  if (!s) throw new HttpError(404, "This squad doesn't exist anymore");
  return s;
}

export async function memberCount(q, id) {
  const [r] = await q("select count(*)::int as n from squad_members where squad_id = $1", [id]);
  return r.n;
}

export async function squadOf(q, wallet) {
  const [r] = await q("select squad_id from squad_members where wallet = $1", [wallet]);
  return r ? r.squad_id : null;
}
