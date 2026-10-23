// Applied on every cold start; every statement is idempotent.
// RLS is on with no policies, so Supabase's public REST API can't touch these tables.
// The server connects as the table owner and is not affected.
export const SCHEMA = `
create table if not exists wallets (
  address text primary key,
  verified_at timestamptz not null default now(),
  last_signature_at timestamptz not null default now()
);

create table if not exists nonces (
  nonce text primary key,
  created_at timestamptz not null default now()
);

create table if not exists squads (
  id serial primary key,
  name text not null,
  photo_url text,
  banner_url text,
  region text not null check (region in ('Asia','USA','EU','Africa')),
  min_pnl_usd integer not null default 0 check (min_pnl_usd >= 0),
  pnl_period text not null default '30d' check (pnl_period in ('7d','30d','all')),
  description text not null default '',
  invite text not null,
  origin text not null check (origin in ('made_here','pumpfun')),
  status text not null default 'recruiting' check (status in ('recruiting','entered')),
  creator_wallet text not null,
  created_at timestamptz not null default now()
);

create table if not exists squad_members (
  squad_id integer not null references squads(id) on delete cascade,
  wallet text not null unique,
  is_creator boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (squad_id, wallet)
);

create table if not exists pnl (
  wallet text primary key,
  pnl_7d double precision,
  pnl_30d double precision,
  pnl_all double precision,
  updated_at timestamptz not null default now()
);

create table if not exists images (
  id text primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

alter table wallets enable row level security;
alter table nonces enable row level security;
alter table squads enable row level security;
alter table squad_members enable row level security;
alter table pnl enable row level security;
alter table images enable row level security;
`;
