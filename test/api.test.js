// End-to-end API test against a throwaway PGlite database: `npm test`
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";

process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "enlist-test-"));
delete process.env.DATABASE_URL;
delete process.env.SOLANATRACKER_API_KEY;

const auth = await import("../api/auth.js");
const squadsApi = await import("../api/squads.js");
const img = await import("../api/img.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function wallet(n) {
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(n));
  return { kp, address: bs58.encode(kp.publicKey), cookie: "" };
}

async function call(handler, url, { body, w, method } = {}) {
  const res = await handler(new Request("http://localhost" + url, {
    method: method || (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", cookie: w?.cookie || "" },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const setCookie = res.headers.get("set-cookie");
  if (w && setCookie) w.cookie = setCookie.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, data: type.includes("json") ? await res.json() : await res.arrayBuffer() };
}

async function signIn(w) {
  const { data } = await call(auth.POST, "/api/auth?action=nonce", { body: {} });
  const sig = nacl.sign.detached(new TextEncoder().encode(data.message), w.kp.secretKey);
  return call(auth.POST, "/api/auth?action=verify", {
    w, body: { wallet: w.address, nonce: data.nonce, signature: Buffer.from(sig).toString("base64") },
  });
}

const alice = wallet(1), bob = wallet(2), carol = wallet(3), dave = wallet(4);

test("sign-in checks the signature and the nonce", async () => {
  const { data } = await call(auth.POST, "/api/auth?action=nonce", { body: {} });
  const wrong = nacl.sign.detached(new TextEncoder().encode(data.message), bob.kp.secretKey);
  const bad = await call(auth.POST, "/api/auth?action=verify", {
    body: { wallet: alice.address, nonce: data.nonce, signature: Buffer.from(wrong).toString("base64") },
  });
  assert.equal(bad.status, 401);
  const reused = await call(auth.POST, "/api/auth?action=verify", {
    body: { wallet: bob.address, nonce: data.nonce, signature: Buffer.from(wrong).toString("base64") },
  });
  assert.equal(reused.status, 400, "a nonce works once");

  const ok = await signIn(alice);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.wallet, alice.address);
  assert.equal(typeof ok.data.pnl.d30, "number");
  const me = await call(auth.GET, "/api/auth", { w: alice });
  assert.equal(me.data.wallet, alice.address);
});

test("create, invite gating, join, lock", async () => {
  const anon = await call(squadsApi.POST, "/api/squads", { body: { action: "create" } });
  assert.equal(anon.status, 401);

  const badInvite = await call(squadsApi.POST, "/api/squads", {
    w: alice, body: { action: "create", name: "Alpha", region: "EU", period: "d30", minPnl: 0, invite: "https://evil.example/x" },
  });
  assert.equal(badInvite.status, 400);

  const created = await call(squadsApi.POST, "/api/squads", {
    w: alice, body: { action: "create", name: "Alpha", region: "EU", period: "d30", minPnl: 0, invite: "https://pump.fun/squads/abc", photo: PNG },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.id;

  const twice = await call(squadsApi.POST, "/api/squads", {
    w: alice, body: { action: "create", name: "Beta", region: "EU", period: "d30", minPnl: 0, invite: "CODE123" },
  });
  assert.equal(twice.status, 409, "one squad per person");

  const list = await call(squadsApi.GET, "/api/squads");
  const s = list.data.squads.find(x => x.id === id);
  assert.equal(s.members, 1);
  assert.equal(s.invite, undefined, "invite is not public");
  const pic = await call(img.GET, s.img.replace("/api/img", "/api/img"));
  assert.equal(pic.status, 200);

  assert.equal((await call(squadsApi.GET, `/api/squads?invite=${id}`)).status, 401);
  await signIn(bob);
  const inv = await call(squadsApi.GET, `/api/squads?invite=${id}`, { w: bob });
  assert.equal(inv.data.invite, "https://pump.fun/squads/abc");

  const join = await call(squadsApi.POST, "/api/squads", { w: bob, body: { action: "join", id } });
  assert.equal(join.status, 200);

  const notMine = await call(squadsApi.POST, "/api/squads", { w: bob, body: { action: "lock", id } });
  assert.equal(notMine.status, 403);
  const lock = await call(squadsApi.POST, "/api/squads", { w: alice, body: { action: "lock", id } });
  assert.equal(lock.status, 200);

  await signIn(carol);
  const late = await call(squadsApi.POST, "/api/squads", { w: carol, body: { action: "join", id } });
  assert.equal(late.status, 403, "no joins after Squad Entry");
});

test("PNL bar blocks people below it", async () => {
  await signIn(dave);
  const created = await call(squadsApi.POST, "/api/squads", {
    w: dave, body: { action: "create", name: "Whales", region: "USA", period: "d30", minPnl: 99_000_000, invite: "WHALES1" },
  });
  const inv = await call(squadsApi.GET, `/api/squads?invite=${created.data.id}`, { w: carol });
  assert.equal(inv.status, 403);
  const join = await call(squadsApi.POST, "/api/squads", { w: carol, body: { action: "join", id: created.data.id } });
  assert.equal(join.status, 403);
});

test("import with member wallets; they stay unverified until they sign", async () => {
  const eve = wallet(5), m1 = wallet(6), m2 = wallet(7);
  await signIn(eve);
  const res = await call(squadsApi.POST, "/api/squads", {
    w: eve, body: { action: "import", name: "Imported", region: "Asia", period: "d7", minPnl: 500, invite: "IMP-42", status: "open", wallets: [m1.address, m2.address, "not-a-wallet"] },
  });
  assert.equal(res.status, 400, "bad address rejected");
  const ok = await call(squadsApi.POST, "/api/squads", {
    w: eve, body: { action: "import", name: "Imported", region: "Asia", period: "d7", minPnl: 500, invite: "IMP-42", status: "open", wallets: [m1.address, m2.address] },
  });
  assert.equal(ok.status, 200);
  let s = (await call(squadsApi.GET, "/api/squads")).data.squads.find(x => x.id === ok.data.id);
  assert.equal(s.origin, "pf");
  assert.equal(s.members, 3);
  assert.equal(s.verified, 1);
  await signIn(m1);
  s = (await call(squadsApi.GET, "/api/squads")).data.squads.find(x => x.id === ok.data.id);
  assert.equal(s.verified, 2);
  assert.equal(typeof s.list.find(m => m.w === m1.address).d30, "number");

  const rm = await call(squadsApi.POST, "/api/squads", { w: eve, body: { action: "remove", id: ok.data.id, wallet: m2.address } });
  assert.equal(rm.status, 200);
  const del = await call(squadsApi.POST, "/api/squads", { w: eve, body: { action: "delete", id: ok.data.id } });
  assert.equal(del.status, 200);
  const gone = (await call(squadsApi.GET, "/api/squads")).data.squads.find(x => x.id === ok.data.id);
  assert.equal(gone, undefined);
});
