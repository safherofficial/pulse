create table if not exists xpulse_editor_memory (
  id text primary key,
  kind text not null check (kind in ('post','thread','article')),
  status text not null check (status in ('accepted','rejected')),
  before_text text not null,
  after_text text not null,
  before_score numeric not null,
  after_score numeric not null,
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists xpulse_editor_memory_kind_status_idx
  on xpulse_editor_memory (kind, status, created_at desc);
