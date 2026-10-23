-- Cloud login sessions: interactive login through a provider live view, saved per
-- user + site + provider. Server-only tables (service_role); the app reads them through server
-- actions that always filter by the signed-in user.

-- browser_auth_states: one row per (user, site, provider) + native persistence reference.
alter table public.browser_auth_states add column provider text not null default 'legacy';
alter table public.browser_auth_states add column native_ref text;
alter table public.browser_auth_states add column status text not null default 'active'
  check (status in ('active', 'expired'));
alter table public.browser_auth_states add column expires_at timestamptz;
alter table public.browser_auth_states add column created_at timestamptz not null default now();

alter table public.browser_auth_states drop constraint browser_auth_states_pkey;
alter table public.browser_auth_states add primary key (user_id, site, provider);

comment on column public.browser_auth_states.storage_enc is
  'Playwright storageState, AES-256-GCM with AUTH_STATE_ENCRYPTION_KEY (header VPA1). Legacy rows: user DEK.';
comment on column public.browser_auth_states.native_ref is
  'Provider-native persistence id (Browserbase Context / Kernel Profile). Not a secret.';

-- Interactive login attempts (live view). Never stores passwords: the user types them in the
-- remote browser.
create table public.browser_login_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  site text not null,
  login_url text not null,
  apply_run_id uuid references public.apply_runs on delete set null,
  status text not null default 'starting' check (status in ('starting', 'opening', 'waiting_user', 'confirm_requested', 'saved', 'cancelled', 'expired', 'failed')),
  provider text,
  provider_id uuid references public.browser_providers on delete set null,
  external_id text,
  live_view_url text,
  native_ref text,
  last_error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index browser_login_sessions_user_idx on public.browser_login_sessions (user_id, created_at desc);

alter table public.browser_login_sessions enable row level security;
revoke all on table public.browser_login_sessions from anon, authenticated;

-- Login sessions are billed like any other cloud browser session.
alter table public.browser_sessions drop constraint browser_sessions_purpose_check;
alter table public.browser_sessions
  add constraint browser_sessions_purpose_check check (purpose in ('apply', 'test', 'login'));
