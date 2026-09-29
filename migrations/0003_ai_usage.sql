-- XPulse AI Gateway usage ledger.
create table if not exists xpulse_ai_usage (
  user_id text not null,
  usage_day date not null default current_date,
  actions integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day)
);
create index if not exists xpulse_ai_usage_day_idx
  on xpulse_ai_usage (usage_day, updated_at desc);
