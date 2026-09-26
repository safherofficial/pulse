-- XPulse wallet-bound trial/lifetime access.
-- Extends the existing wallet/session schema used by data.server.ts.
-- Safe to run on databases that already contain any of these columns.

alter table "session"
  add column if not exists "walletAddress" text;

alter table xpulse_wallets
  add column if not exists plan text not null default 'none';

alter table xpulse_wallets
  add column if not exists trial_started_at timestamptz;

alter table xpulse_wallets
  add column if not exists trial_expires_at timestamptz;

alter table xpulse_wallets
  add column if not exists updated_at timestamptz not null default now();

-- Existing paid wallets keep their lifetime entitlement.
update xpulse_wallets
set plan = 'lifetime'
where is_lifetime = true
  and plan <> 'lifetime';

create index if not exists session_walletAddress_idx
  on "session" ("walletAddress");

create index if not exists xpulse_wallets_plan_idx
  on xpulse_wallets (plan);
