-- "Permissões do agente": per-action modes, per-domain allow/deny rules and an append-only
-- activity log of automatic decisions. Server-only (service role); never applied automatically.
-- Grants/revocations are also chained in public.legal_acceptances (permission_grant/_revoke).

create table public.agent_permissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null check (action_type in ('accept_site_terms', 'create_site_account', 'open_email_link', 'use_email_code', 'final_submit', 'accept_marketing_optin')),
  mode text not null default 'ask' check (mode in ('ask', 'allowlist', 'auto', 'deny')),
  -- final_submit only: extra typed confirmation; auto/allowlist ignored while null.
  final_submit_confirmed_at timestamptz,
  -- "auto" mode: data categories the user explicitly confirmed (sensitive ones need typed confirmation).
  categories text[] not null default '{}',
  ack_record_hash text,
  updated_at timestamptz not null default now(),
  primary key (user_id, action_type)
);

alter table public.agent_permissions enable row level security;
revoke all on table public.agent_permissions from anon, authenticated;

create table public.agent_permission_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null,
  domain_pattern text not null check (domain_pattern ~ '^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$'),
  effect text not null check (effect in ('allow', 'deny')),
  categories text[] not null default '{}',
  source text not null default 'settings' check (source in ('settings', 'run_card')),
  ack_record_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, action_type, domain_pattern, effect)
);

create index agent_permission_rules_user_idx on public.agent_permission_rules (user_id, action_type);
alter table public.agent_permission_rules enable row level security;
revoke all on table public.agent_permission_rules from anon, authenticated;

-- What the agent did (or was blocked from doing) under a standing permission. Append-only.
create table public.agent_permission_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id uuid,
  action_type text not null,
  site text not null,
  decision text not null check (decision in ('allow', 'deny')),
  reason text not null,
  rule_id uuid,
  categories text[] not null default '{}',
  field_label text,
  terms_url text,
  terms_sha256 text,
  created_at timestamptz not null default now()
);

create index agent_permission_events_user_idx on public.agent_permission_events (user_id, created_at desc);
alter table public.agent_permission_events enable row level security;
revoke all on table public.agent_permission_events from anon, authenticated;

create trigger agent_permission_events_append_only
before update or delete on public.agent_permission_events
for each row execute function public.block_mutation();

-- Notification preferences (sensitive data summary e-mail is OFF by default).
create table public.agent_permission_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  notify_sensitive_email boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.agent_permission_prefs enable row level security;
revoke all on table public.agent_permission_prefs from anon, authenticated;

-- "Dados sensíveis enviados": owner-only report sealed with AUTH_STATE_ENCRYPTION_KEY
-- (AES-256-GCM, AAD bound to user + run). Admin views read sensitive_counts only.
alter table public.apply_runs add column sensitive_report_enc bytea;
alter table public.apply_runs add column sensitive_counts jsonb not null default '{}'::jsonb;
