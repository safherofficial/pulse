-- XPulse: profiles, lifetime wallets, posts, links, snapshots, activity.

create table if not exists xpulse_profiles (
  user_id text primary key,
  x_id text,
  x_username text,
  x_access_token text,
  x_refresh_token text,
  x_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists xpulse_wallets (
  address text primary key,
  user_id text not null,
  is_lifetime boolean not null default false,
  paid_at timestamptz,
  tx_signature text,
  cluster text,
  created_at timestamptz not null default now()
);

create unique index if not exists xpulse_wallets_tx_idx
  on xpulse_wallets (tx_signature)
  where tx_signature is not null;

create index if not exists xpulse_wallets_user_idx on xpulse_wallets (user_id);

create table if not exists xpulse_nonces (
  id text primary key,
  user_id text not null,
  nonce text not null,
  expires_at timestamptz not null
);

create index if not exists xpulse_nonces_user_idx on xpulse_nonces (user_id);

create table if not exists xpulse_posts (
  id text primary key,
  user_id text not null,
  x_post_id text not null,
  type text not null,
  text text not null,
  metrics jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, x_post_id)
);

create index if not exists xpulse_posts_user_idx on xpulse_posts (user_id, published_at desc);

create table if not exists xpulse_links (
  id text primary key,
  user_id text not null,
  article_post_id text not null,
  thread_post_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists xpulse_links_user_idx on xpulse_links (user_id, created_at desc);

create table if not exists xpulse_snapshots (
  id text primary key,
  user_id text not null,
  post_id text not null,
  metrics jsonb not null,
  captured_at timestamptz not null default now()
);

create index if not exists xpulse_snapshots_post_idx
  on xpulse_snapshots (user_id, post_id, captured_at desc);

create table if not exists xpulse_activity (
  user_id text not null,
  dow int not null,
  hour int not null,
  intensity double precision not null,
  primary key (user_id, dow, hour)
);

create table if not exists xpulse_oauth (
  state text primary key,
  user_id text not null,
  verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null
);
