-- Catalog of official / public Web3 accounts used for social-signal matching.
-- Handles are stored normalized (lowercase, no @). Never invent official status.

create table if not exists public_social_accounts (
  id text primary key,
  platform text not null,
  handle text not null,
  display_name text not null,
  profile_url text not null,
  category text not null,
  official boolean not null default false,
  source text not null,
  verification_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists public_social_accounts_platform_handle_idx
  on public_social_accounts (platform, handle);
