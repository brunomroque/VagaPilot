-- Cloud browser pool (Browserless, Steel, Kernel, Browserbase, Hyperbrowser), admin role and
-- cloud apply runs. Secrets never live here: browser_providers stores only the NAME of the env
-- var that holds the key (secret_env_var), resolved on the server at runtime.

-- Admin role ---------------------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on table public.app_admins from anon, authenticated;

-- security definer so policies on other tables can call it without exposing app_admins.
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated, service_role;

-- Providers ----------------------------------------------------------------------------------
create table public.browser_providers (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('browserless', 'steel', 'kernel', 'browserbase', 'hyperbrowser')),
  label text not null,
  account_email text,
  secret_env_var text not null check (secret_env_var ~ '^[A-Z][A-Z0-9_]*$'),
  project_env_var text check (project_env_var is null or project_env_var ~ '^[A-Z][A-Z0-9_]*$'),
  enabled boolean not null default true,
  priority integer not null default 100,
  concurrency_limit integer not null default 1 check (concurrency_limit > 0),
  max_session_seconds integer check (max_session_seconds is null or max_session_seconds > 0),
  quota_kind text not null check (quota_kind in ('units_monthly', 'credits_monthly', 'credits_one_time')),
  quota_unit text not null default 'units',
  quota_limit numeric not null check (quota_limit >= 0),
  cost_per_minute numeric not null default 0 check (cost_per_minute >= 0),
  quota_reset_day integer check (quota_reset_day is null or quota_reset_day between 1 and 31),
  quota_started_at timestamptz not null default now(),
  key_expires_at timestamptz,
  alert_threshold numeric not null default 0.8 check (alert_threshold > 0 and alert_threshold <= 1),
  notes text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.browser_providers enable row level security;
revoke all on table public.browser_providers from anon;
grant select, insert, update, delete on table public.browser_providers to authenticated;

create policy browser_providers_admin_all on public.browser_providers
  for all to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

-- Sessions (one row per cloud browser session) ------------------------------------------------
create table public.browser_sessions (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.browser_providers on delete set null,
  provider text not null,
  user_id uuid references auth.users on delete cascade,
  apply_run_id uuid,
  external_id text,
  status text not null default 'ativa' check (status in ('ativa', 'encerrada', 'falhou')),
  purpose text not null default 'apply' check (purpose in ('apply', 'test')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  units_used numeric not null default 0,
  error_code text,
  error_message text
);

create index browser_sessions_provider_started_idx
  on public.browser_sessions (provider_id, started_at desc);
create index browser_sessions_user_id_idx on public.browser_sessions (user_id);

alter table public.browser_sessions enable row level security;
revoke all on table public.browser_sessions from anon;
revoke insert, update, delete on table public.browser_sessions from authenticated;
grant select on table public.browser_sessions to authenticated;

create policy browser_sessions_admin_select on public.browser_sessions
  for select to authenticated
  using ((select public.is_app_admin()));

-- Cloud apply runs (resumable state machine; server writes only) -----------------------------
create table public.apply_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  job_match_id uuid references public.job_matches on delete set null,
  package_id uuid references public.application_packages on delete set null,
  ats text not null,
  target_url text not null,
  phase text not null default 'queued' check (phase in ('queued', 'running', 'login_required', 'waiting_answers', 'captcha', 'review_ready', 'submit_approved', 'submitting', 'submitted', 'failed', 'cancelled')),
  step_index integer not null default 0,
  segments integer not null default 0,
  state_enc bytea,
  review_summary jsonb,
  review_screenshot_enc bytea,
  approval_id uuid references public.approvals on delete set null,
  provider_id uuid references public.browser_providers on delete set null,
  live_view_url text,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index apply_runs_user_id_idx on public.apply_runs (user_id);
create index apply_runs_application_id_idx on public.apply_runs (application_id);

alter table public.apply_runs enable row level security;
revoke all on table public.apply_runs from anon, authenticated;

alter table public.browser_sessions
  add constraint browser_sessions_apply_run_fk
  foreign key (apply_run_id) references public.apply_runs on delete set null;

-- Encrypted login state (cookies/localStorage) per user and site, sealed with the user DEK.
create table public.browser_auth_states (
  user_id uuid not null references auth.users on delete cascade,
  site text not null,
  storage_enc bytea not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, site)
);

alter table public.browser_auth_states enable row level security;
revoke all on table public.browser_auth_states from anon, authenticated;

-- Seeds (no secrets: only env var names) -----------------------------------------------------
insert into public.browser_providers
  (provider, label, account_email, secret_env_var, project_env_var, enabled, priority,
   concurrency_limit, max_session_seconds, quota_kind, quota_unit, quota_limit,
   cost_per_minute, quota_reset_day, key_expires_at, notes)
values
  ('browserless', 'Browserless #1', 'Browserless01@isaleo.solutions', 'BROWSERLESS_API_TOKEN', null,
   true, 10, 2, 900, 'units_monthly', 'units', 1000, 2, 23, null,
   'Free: 1000 unidades/mês (1 unidade = 30 s), 2 concorrentes, renova dia 23.'),
  ('steel', 'Steel #1', 'Steel01@isaleo.solutions', 'STEEL_API_KEY', null,
   true, 20, 10, 900, 'credits_one_time', 'USD', 30, 0.00166667, null, null,
   'Crédito único de US$ 30 (~US$ 0,10/h), 10 concorrentes, sessão máx. 15 min.'),
  ('kernel', 'Kernel #1', 'Kernel01@isaleo.solutions', 'KERNEL_API_KEY', null,
   true, 30, 5, 900, 'credits_monthly', 'USD', 5, 0.0027, 1, '2026-11-22T23:59:59-03:00',
   'US$ 5/mês, 5 concorrentes, renova no fim do mês. Chave expira em 22/11/2026. Custo/min estimado (headful): ajuste se necessário.'),
  ('browserbase', 'Browserbase #1', 'Browserbase01@isaleo.solutions', 'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID',
   true, 40, 3, 900, 'units_monthly', 'min', 60, 1, 22, null,
   'Free: 60 min de navegador/mês, 3 concorrentes, timeout padrão 5 min (o app pede o timeout explícito), renova dia 22.'),
  ('hyperbrowser', 'Hyperbrowser #1', null, 'HYPERBROWSER_API_KEY', null,
   false, 50, 1, 900, 'credits_one_time', 'credits', 1000, 1, null, null,
   'Desativado: o cadastro recusou o domínio. Ajuste créditos e custo/min ao ativar.');
