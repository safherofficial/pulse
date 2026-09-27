-- Daily viral-trend and content-logic versions. Append-only history.
-- A failed or duplicate run must not replace the active version.

create table if not exists xpulse_trend_versions (
  version text primary key,
  version_number integer not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists xpulse_trend_versions_status_idx
  on xpulse_trend_versions (status, version_number desc);

create table if not exists xpulse_content_logic_versions (
  version text primary key,
  version_number integer not null,
  trend_version text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists xpulse_content_logic_versions_status_idx
  on xpulse_content_logic_versions (status, version_number desc);

create table if not exists xpulse_optimization_runs (
  optimization_run_id text primary key,
  day_key text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null,
  previous_trend_version text not null,
  previous_content_version text not null,
  trend_version text not null,
  content_logic_version text not null,
  rollback_available boolean not null default false,
  attempts integer not null default 1,
  payload jsonb not null
);

create unique index if not exists xpulse_optimization_runs_day_idx
  on xpulse_optimization_runs (day_key);

create table if not exists xpulse_optimization_experiments (
  experiment_id text primary key,
  run_id text not null,
  rule_id text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists xpulse_optimization_experiments_run_idx
  on xpulse_optimization_experiments (run_id);
