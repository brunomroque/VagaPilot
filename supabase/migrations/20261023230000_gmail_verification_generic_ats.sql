-- Site accounts created by the bot on ATSs with the user's e-mail, outcome metrics per ATS.
-- Passwords are generated server side and sealed with AUTH_STATE_ENCRYPTION_KEY
-- (AES-256-GCM, header VPA1, AAD "vp-cred|<user>|<site>"). Never stored in clear.

create table public.ats_credentials (
  user_id uuid not null references auth.users on delete cascade,
  site text not null,
  email text not null,
  password_enc bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, site)
);

alter table public.ats_credentials enable row level security;
revoke all on table public.ats_credentials from anon, authenticated;

comment on column public.ats_credentials.password_enc is
  'Site password, AES-256-GCM with AUTH_STATE_ENCRYPTION_KEY (header VPA1). Decrypted only server side.';

-- One row per apply segment outcome (submitted, review, waiting_*, failed...).
create table public.apply_run_outcomes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.apply_runs on delete set null,
  user_id uuid references auth.users on delete cascade,
  ats text not null,
  driver text not null check (driver in ('specific', 'generic_ai')),
  site text not null,
  outcome text not null,
  code text,
  duration_ms integer not null default 0,
  llm_calls integer not null default 0,
  llm_tokens integer not null default 0,
  replayed_steps integer not null default 0,
  created_at timestamptz not null default now()
);

create index apply_run_outcomes_ats_idx on public.apply_run_outcomes (ats, site, created_at desc);

alter table public.apply_run_outcomes enable row level security;
revoke all on table public.apply_run_outcomes from anon, authenticated;

create view public.apply_ats_success_rates
with (security_invoker = true) as
select
  ats,
  driver,
  site,
  count(distinct run_id) as attempts,
  count(distinct run_id) filter (where outcome = 'submitted') as submitted,
  count(distinct run_id) filter (where outcome = 'failed') as failed,
  count(distinct run_id) filter (where outcome like 'waiting_%') as escalated,
  round(
    (count(distinct run_id) filter (where outcome = 'submitted'))::numeric
      / nullif(count(distinct run_id), 0),
    3
  ) as success_rate,
  sum(llm_tokens) as llm_tokens,
  sum(replayed_steps) as replayed_steps
from public.apply_run_outcomes
group by ats, driver, site;

revoke all on public.apply_ats_success_rates from anon, authenticated;

-- Learned recipes of unknown ATSs (generic AI driver). Page structure only: ordered steps with
-- expected-state assertions, form fingerprint and role descriptors (role/label/text/name).
-- Never values, answers or secrets. One row per version; old versions stay for rollback.
create table public.ats_recipes (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  platform text not null,
  version integer not null,
  parent_version integer,
  status text not null default 'learning' check (status in ('learning', 'trusted', 'stale', 'relearning', 'disabled')),
  steps jsonb not null default '[]'::jsonb,
  successes integer not null default 0,
  failures integer not null default 0,
  last_validated_at timestamptz,
  drift_history jsonb not null default '[]'::jsonb,
  disabled_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain, version)
);

create index ats_recipes_domain_idx on public.ats_recipes (domain, version desc);

alter table public.ats_recipes enable row level security;
revoke all on table public.ats_recipes from anon, authenticated;
