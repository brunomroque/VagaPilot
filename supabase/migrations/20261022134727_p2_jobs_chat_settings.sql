-- P2.1–P2.5: job ingestion progress, saved searches and the F14 settings model
-- (spec 8.4, 9.3 note on F14 tables, F4A RF4A.3, F14 RF14.1–RF14.6).
-- Every table is user-owned with the standard (select auth.uid()) = user_id policies.
-- Columns of saved_searches are exactly the request fields the spec lists, plus scheduling state.

-- ---------------------------------------------------------------------------
-- saved_searches (RF4A.3): created by chat or form, same record either way (CA14.7)
-- ---------------------------------------------------------------------------

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  query text not null check (char_length(query) between 2 and 120),
  seniority public.seniority,
  location text check (location is null or char_length(location) <= 120),
  radius_km int check (radius_km is null or radius_km between 0 and 500),
  work_model public.work_model,
  regime public.contract_regime check (regime is null or regime in ('clt', 'pj', 'ambos')),
  language text check (language is null or language in ('pt-BR', 'en', 'es')),
  salary_min numeric(12,2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12,2) check (salary_max is null or salary_max >= 0),
  posted_within_days int check (posted_within_days is null or posted_within_days between 1 and 90),
  excluded_companies text[] not null default '{}',
  frequency text not null default 'diaria' check (frequency in ('diaria', 'dias_uteis', 'semanal')),
  time_of_day text check (time_of_day is null or time_of_day in ('manha', 'tarde', 'noite')),
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_searches
  add constraint saved_searches_salary_range_check
  check (salary_min is null or salary_max is null or salary_min <= salary_max);

-- ---------------------------------------------------------------------------
-- job_ingestions: one row per pasted link (or text) of a batch, published via Realtime (8.4)
-- ---------------------------------------------------------------------------

create table public.job_ingestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  batch_id uuid not null,
  conversation_id uuid references public.conversations on delete set null,
  saved_search_id uuid references public.saved_searches on delete cascade,
  input_url text check (input_url is null or char_length(input_url) <= 2000),
  input_text text check (input_text is null or char_length(input_text) <= 20000),
  canonical_url text,
  source public.job_source,
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'concluida', 'falhou', 'bloqueada')),
  error_code text,
  job_posting_id uuid references public.job_postings,
  job_match_id uuid references public.job_matches on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_ingestions
  add constraint job_ingestions_input_check
  check (input_url is not null or input_text is not null or saved_search_id is not null);

-- ---------------------------------------------------------------------------
-- F14 typed settings
-- ---------------------------------------------------------------------------

-- "Não quero mais vagas da empresa Y": global exclusions on top of company_blocklist (9.3 note).
create table public.excluded_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 160),
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

-- set_preference: enum keys only (validated again in packages/core/settings.ts).
create table public.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  key text not null check (key in ('email.include_salary', 'searches.min_fit')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  approval_mode text not null default 'pausar_antes' check (approval_mode in ('pausar_antes', 'envie_direto')),
  updated_at timestamptz not null default now()
);

-- Memory (RF14.5): every change with origin, original phrase, before/after and status.
-- `before` is the exact previous state, so undo restores it (CA14.2).
create table public.memory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  intent text not null,
  origin text not null check (origin in ('chat', 'formulario', 'automacao')),
  utterance text check (utterance is null or char_length(utterance) <= 2000),
  target_type text not null,
  target_id uuid,
  before jsonb,
  after jsonb,
  status text not null default 'aplicada' check (status in ('aplicada', 'desfeita', 'pendente', 'cancelada')),
  conversation_id uuid references public.conversations on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.memory_events
  add constraint memory_events_intent_check
  check (intent in (
    'create_saved_search', 'update_saved_search', 'delete_saved_search',
    'add_excluded_company', 'remove_excluded_company', 'update_language_level',
    'set_salary_rules', 'set_preference', 'set_approval_mode'
  ));

-- ---------------------------------------------------------------------------
-- Indexes, triggers and RLS
-- ---------------------------------------------------------------------------

create index saved_searches_user_id_idx on public.saved_searches (user_id, created_at);
create index job_ingestions_user_batch_idx on public.job_ingestions (user_id, batch_id);
create index job_ingestions_user_created_idx on public.job_ingestions (user_id, created_at desc);
create index job_ingestions_saved_search_idx on public.job_ingestions (saved_search_id);
create index job_ingestions_job_posting_idx on public.job_ingestions (job_posting_id);
create index job_ingestions_job_match_idx on public.job_ingestions (job_match_id);
create index job_ingestions_conversation_idx on public.job_ingestions (conversation_id);
create index memory_events_user_created_idx on public.memory_events (user_id, created_at desc);
create index memory_events_conversation_idx on public.memory_events (conversation_id);
create index job_matches_user_created_idx on public.job_matches (user_id, created_at desc);
create index messages_user_role_created_idx on public.messages (user_id, role, created_at desc);

create trigger saved_searches_set_updated_at before update on public.saved_searches
  for each row execute function public.set_updated_at();
create trigger job_ingestions_set_updated_at before update on public.job_ingestions
  for each row execute function public.set_updated_at();
create trigger preferences_set_updated_at before update on public.preferences
  for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'saved_searches', 'job_ingestions', 'excluded_companies', 'preferences', 'user_settings',
    'memory_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end;
$$;

-- Realtime progress of a batch (8.4). RLS still applies to the change feed.
alter publication supabase_realtime add table public.job_ingestions;
