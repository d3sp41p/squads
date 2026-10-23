# Enlist

Find a squad for the Pumpfun Squads Competition, filtered by real PNL.

Plain HTML/CSS/JS front end (`public/`), Vercel serverless functions (`api/`), Postgres on Supabase. No build step.

## Deploy (about 30 minutes)

1. **Supabase** → New project (region close to your users). Then **Connect → Transaction pooler** and copy the URI (port 6543). Put your database password into it. Tables are created automatically on first request.
2. **Solana Tracker** → [solanatracker.io/data-api](https://www.solanatracker.io/data-api) → sign up and copy the API key. The free plan is 2,500 requests a month; each PNL refresh takes 3, so upgrade once real traffic comes in.
3. **Vercel** → Add New Project → import this GitHub repo. Framework preset: **Other**, no build command. Before deploying, add Environment Variables (see `.env.example`):
   - `DATABASE_URL` — the Supabase pooler URI
   - `SESSION_SECRET` — a long random string
   - `SOLANATRACKER_API_KEY`
   - `CRON_SECRET` — a long random string
4. Deploy, then **Settings → Domains** → add your domain and set the DNS records Vercel shows.
5. Open the site, connect the owner's wallet and create or import the real squad.

Every push to `main` redeploys automatically.

## Before launch

- [ ] Replace `public/img/hero.webp` (the mascots wear "PumpFun" patches) with art without Pumpfun marks. Same size (≈880×740, transparent WebP).
- [ ] Optional: add a contact email next to the X link in `public/privacy.html` and `public/terms.html`.
- [ ] Optional: add `<meta property="og:image" content="https://YOUR-DOMAIN/img/og.png">` (1200×630) to `public/index.html` for link previews.
- [ ] Test sign-in with Phantom on desktop and inside the Phantom app on a phone.

## How it works

- **Sign-in:** the server issues a one-time nonce, the wallet signs `Sign in to Enlist: <nonce>`, the server checks the ed25519 signature and sets an HttpOnly session cookie (30 days). No transactions, ever.
- **PNL:** fetched from Solana Tracker on sign-in (cached for an hour) and by a daily cron for verified squad members (`/api/cron`, Vercel Hobby allows one run a day; on Pro change the schedule in `vercel.json`). 7D/30D = realized PNL over the window, all-time = total PNL. Only verified wallets (signed in at least once) count toward squad totals.
- **Invites** are only sent to signed-in users who meet the squad's entry PNL, and must be a `pump.fun` link or a plain code.
- **Joining:** a trader joins in the Pumpfun app, then taps "I joined in the Pumpfun app" so the listing shows them. The creator can remove anyone from the listing.
- **Rules enforced on the server:** max 20 members, one squad per wallet, only the creator can lock, remove members or delete, no joins after Squad Entry, images resized in the browser and checked on the server.
- Enlist never calls or scrapes Pumpfun.

## Local development

```bash
npm install
npm run dev     # http://localhost:3000, uses an in-process Postgres (PGlite) in .data/ and fake PNL
npm test        # end-to-end API tests
```

To sign in locally without a wallet extension, run this in the browser console:

```js
for (const s of ["/dev/nacl.js", "/dev/mock-wallet.js"]) await new Promise(r => { const e = document.createElement("script"); e.src = s; e.onload = r; document.head.append(e); });
```

Set `localStorage.mockSeed = "2"` before loading it to get a different wallet.

## API

| Route | What it does |
| --- | --- |
| `GET /api/auth` | Signed-in wallet, its PNL and squad |
| `POST /api/auth?action=nonce\|verify\|logout` | Sign-in steps |
| `GET /api/squads` | All squads with members (no invites) |
| `GET /api/squads?invite=<id>` | The invite, for qualifying signed-in users |
| `POST /api/squads` | `action`: `create`, `import`, `lock`, `join`, `remove`, `delete` |
| `GET /api/img?id=<id>` | Squad photo or banner |
| `GET /api/cron` | PNL refresh (Vercel Cron only) |
