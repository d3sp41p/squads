import { SCHEMA } from "./schema.js";

// Production: Supabase Postgres through DATABASE_URL (use the transaction pooler URL, port 6543).
// Local dev without DATABASE_URL: PGlite, an in-process Postgres stored in ./.data/pglite.
let ready;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
    await sql.unsafe(SCHEMA);
    return {
      query: (text, params = []) => sql.unsafe(text, params),
      transaction: fn => sql.begin(t => fn((text, params = []) => t.unsafe(text, params))),
    };
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL is not set");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || "./.data/pglite";
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.exec(SCHEMA);
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows,
    transaction: fn => db.transaction(tx => fn(async (text, params = []) => (await tx.query(text, params)).rows)),
  };
}

function db() {
  ready ||= connect().catch(e => { ready = null; throw e; });
  return ready;
}

export async function query(text, params) {
  return (await db()).query(text, params);
}

// fn gets a query function bound to the transaction.
export async function transaction(fn) {
  return (await db()).transaction(fn);
}
