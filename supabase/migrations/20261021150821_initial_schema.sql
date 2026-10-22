-- VagaPilot initial schema. Mirrors docs/ESPEC-app-assistente-vagas.pdf section 9 (v1.4).
-- Order matters: evidences and email_threads are created before application_events.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 9.2 Enums
-- ---------------------------------------------------------------------------

create type public.employment_type as enum ('clt','pj','autonomo','estagio','temporario','cooperado','outro');
create type public.seniority as enum
  ('estagio','junior','pleno','senior','especialista','coordenador','gerente','head','diretor','vp','c_level');
create type public.work_model as enum ('presencial','hibrido','remoto');
create type public.contract_regime as enum ('clt','pj','ambos','nao_informado');
create type public.fact_status as enum ('proposto','confirmado','rejeitado');
create type public.fit_level as enum ('alto','medio','baixo');
create type public.job_source as enum
  ('linkedin','gupy','inhire','greenhouse','lever','workday','successfactors','quickin','jobbol','solides','email','indicacao','outro');
create type public.application_route as enum ('extensao','email','manual','autonomo');
create type public.application_status as enum
  ('rascunho','descartada','em_andamento','enviada','em_analise','etapa_pendente','entrevista','proposta','reprovada','encerrada');
create type public.event_source as enum ('usuario','agente','extensao','gmail','worker','sistema');
create type public.approval_status as enum ('pendente','aprovada','rejeitada','expirada');
create type public.approval_kind as enum
  ('enviar_email','submeter_formulario','responder_pergunta','alterar_cv','criar_fato','pre_autorizacao');
create type public.email_class as enum
  ('confirmacao','reprovacao','teste_etapa','convite_entrevista','recrutador_contato','vaga_alerta','irrelevante');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.3 Tables: profile and facts
-- ---------------------------------------------------------------------------

create table public.candidate_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  first_name text,
  last_name text,
  email_contact text,
  phone_enc bytea,
  city text,
  state char(2),
  country char(2) default 'BR',
  address_enc bytea,
  documents_enc bytea,
  linkedin_url text,
  portfolio_url text,
  birth_date_enc bytea,
  diversity_enc bytea,
  preferences jsonb not null default '{}',
  locale text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  cv_filename_pattern text not null default 'CV-{first}-{last}-{lang}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  company text not null,
  title text not null,
  employment_type public.employment_type not null,
  start_date date not null,
  end_date date,
  is_current boolean default false,
  location text,
  description text,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.educations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  institution text not null,
  degree text,
  field text,
  level text,
  start_date date,
  end_date date,
  status text
);

create table public.languages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  language text not null,
  level text not null
);

create table public.confirmed_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  experience_id uuid references public.experiences on delete set null,
  statement text not null,
  statement_en text,
  kind text not null,
  tags text[] default '{}',
  status public.fact_status not null default 'proposto',
  source text not null,
  source_ref jsonb,
  confirmed_at timestamptz,
  embedding extensions.vector(1536),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.cv_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  description text,
  keywords text[] default '{}'
);

create table public.cv_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  track_id uuid references public.cv_tracks on delete set null,
  language text not null,
  label text not null,
  is_default boolean default false,
  storage_path text not null,
  docx_storage_path text,
  file_sha256 text not null,
  extracted_text text,
  origin text not null,
  parent_version_id uuid references public.cv_versions,
  fact_ids uuid[] default '{}',
  created_at timestamptz default now()
);

create table public.salary_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  seniority public.seniority not null,
  regime public.contract_regime not null,
  amount_min numeric(12,2),
  amount_target numeric(12,2) not null,
  currency char(3) default 'BRL',
  period text default 'mensal',
  notes text,
  unique (user_id, seniority, regime)
);

create table public.standard_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  question_examples text[] default '{}',
  answer text,
  answer_enc bytea,
  language text default 'pt-BR',
  is_sensitive boolean default false,
  embedding extensions.vector(1536),
  updated_at timestamptz default now(),
  unique (user_id, key, language)
);

create table public.company_blocklist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  company_name text not null,
  normalized_name text not null,
  aliases text[] default '{}',
  domains text[] default '{}',
  reason text
);

-- ---------------------------------------------------------------------------
-- Jobs (global, public data) and per-user analysis
-- ---------------------------------------------------------------------------

create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  canonical_url text unique not null,
  source public.job_source not null,
  external_id text,
  company text,
  company_normalized text,
  company_domain text,
  title text not null,
  seniority public.seniority,
  location text,
  work_model public.work_model,
  regime public.contract_regime default 'nao_informado',
  language text,
  requirements_required text[] default '{}',
  requirements_preferred text[] default '{}',
  languages_required jsonb default '[]',
  salary_min numeric,
  salary_max numeric,
  salary_currency char(3),
  apply_url text,
  apply_email text,
  description_md text,
  raw_hash text,
  posted_at date,
  fetched_at timestamptz default now(),
  closed_at timestamptz,
  embedding extensions.vector(1536)
);

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  job_posting_id uuid not null references public.job_postings,
  fit public.fit_level,
  fit_score int,
  reasons jsonb default '[]',
  gaps jsonb default '[]',
  alerts jsonb default '[]',
  recommended_cv_version_id uuid references public.cv_versions,
  suggested_salary jsonb,
  duplicate_check jsonb,
  blocked boolean default false,
  decision text,
  decision_reason text,
  model_version text,
  prompt_version text,
  created_at timestamptz default now(),
  unique (user_id, job_posting_id)
);

-- ---------------------------------------------------------------------------
-- Applications and dependants
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  job_match_id uuid references public.job_matches,
  job_posting_id uuid references public.job_postings,
  company text not null,
  role_title text not null,
  source public.job_source not null,
  route public.application_route,
  status public.application_status not null default 'rascunho',
  applied_at timestamptz,
  cv_version_id uuid references public.cv_versions,
  cv_sha256 text,
  salary_informed jsonb,
  next_action text,
  next_action_due_at timestamptz,
  link text,
  notes text,
  external_protocol text,
  last_email_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.evidences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid references public.applications on delete cascade,
  kind text not null,
  storage_path text,
  text_excerpt text,
  url text,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  gmail_thread_id text not null,
  gmail_message_id text not null,
  from_address text,
  from_domain text,
  subject text,
  received_at timestamptz not null,
  snippet text,
  classification public.email_class,
  confidence numeric(3,2),
  extracted jsonb,
  application_id uuid references public.applications on delete set null,
  review_status text default 'auto',
  unique (user_id, gmail_message_id)
);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  type text not null,
  from_status public.application_status,
  to_status public.application_status,
  source public.event_source not null,
  confidence numeric(3,2),
  payload jsonb default '{}',
  email_thread_id uuid references public.email_threads,
  evidence_id uuid references public.evidences,
  occurred_at timestamptz not null default now()
);

create table public.application_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  payload_enc bytea not null,
  cv_version_id uuid references public.cv_versions,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table public.pending_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid references public.applications on delete cascade,
  question_text text not null,
  field_type text,
  options jsonb,
  proposed_answer text,
  proposed_from jsonb,
  answer text,
  remember boolean default false,
  status text default 'aberta',
  created_at timestamptz default now(),
  answered_at timestamptz
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind public.approval_kind not null,
  application_id uuid references public.applications on delete cascade,
  subject_ref jsonb not null,
  preview jsonb not null,
  preview_sha256 text not null,
  status public.approval_status not null default 'pendente',
  decided_at timestamptz,
  decided_via text,
  expires_at timestamptz not null,
  scope jsonb,
  created_at timestamptz default now()
);

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id uuid references public.applications on delete cascade,
  to_addresses text[] not null,
  cc_addresses text[] default '{}',
  subject text not null,
  body_md text not null,
  attachment_cv_version_id uuid references public.cv_versions,
  status text default 'rascunho',
  gmail_message_id text,
  gmail_thread_id text,
  sent_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Gmail, chat, audit, consents, devices, billing
-- ---------------------------------------------------------------------------

create table public.gmail_connections (
  user_id uuid primary key references auth.users on delete cascade,
  google_email text not null,
  scopes text[] not null,
  refresh_token_enc bytea not null,
  last_history_id text,
  last_synced_at timestamptz,
  status text default 'ativo'
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text,
  created_at timestamptz default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  role text not null,
  parts jsonb not null,
  created_at timestamptz default now()
);

-- Append-only. No FK to auth.users on purpose: entries outlive account deletion (pseudonymized, 12.x).
create table public.audit_log (
  id bigserial primary key,
  user_id uuid not null,
  actor text not null,
  action text not null,
  target_type text,
  target_id uuid,
  approval_id uuid,
  details jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  purpose text not null,
  version text not null,
  granted boolean not null,
  created_at timestamptz default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text,
  token_hash text not null,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',
  status text,
  current_period_end timestamptz
);

create table public.usage_counters (
  user_id uuid,
  period char(7),
  metric text,
  value int default 0,
  primary key (user_id, period, metric)
);

create table public.stripe_events (
  id text primary key,
  processed_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index confirmed_facts_embedding_hnsw on public.confirmed_facts
  using hnsw (embedding extensions.vector_cosine_ops);
create index applications_user_status_idx on public.applications (user_id, status);
create index applications_user_next_action_idx on public.applications (user_id, next_action_due_at);

-- user_id lookups back every RLS policy.
create index experiences_user_id_idx on public.experiences (user_id);
create index educations_user_id_idx on public.educations (user_id);
create index languages_user_id_idx on public.languages (user_id);
create index confirmed_facts_user_id_idx on public.confirmed_facts (user_id);
create index confirmed_facts_experience_id_idx on public.confirmed_facts (experience_id);
create index cv_tracks_user_id_idx on public.cv_tracks (user_id);
create index cv_versions_user_id_idx on public.cv_versions (user_id);
create index cv_versions_track_id_idx on public.cv_versions (track_id);
create index company_blocklist_user_id_idx on public.company_blocklist (user_id);
create index company_blocklist_normalized_name_idx on public.company_blocklist (user_id, normalized_name);
create index job_postings_company_normalized_idx on public.job_postings (company_normalized);
create index job_matches_job_posting_id_idx on public.job_matches (job_posting_id);
create index evidences_user_id_idx on public.evidences (user_id);
create index evidences_application_id_idx on public.evidences (application_id);
create index email_threads_application_id_idx on public.email_threads (application_id);
create index email_threads_user_thread_idx on public.email_threads (user_id, gmail_thread_id);
create index application_events_user_id_idx on public.application_events (user_id);
create index application_events_application_id_idx on public.application_events (application_id, occurred_at);
create index application_packages_user_id_idx on public.application_packages (user_id);
create index application_packages_application_id_idx on public.application_packages (application_id);
create index pending_questions_user_id_idx on public.pending_questions (user_id);
create index pending_questions_application_id_idx on public.pending_questions (application_id);
create index approvals_user_id_idx on public.approvals (user_id);
create index approvals_application_id_idx on public.approvals (application_id);
create index email_drafts_user_id_idx on public.email_drafts (user_id);
create index email_drafts_application_id_idx on public.email_drafts (application_id);
create index conversations_user_id_idx on public.conversations (user_id);
create index messages_user_id_idx on public.messages (user_id);
create index messages_conversation_id_idx on public.messages (conversation_id, created_at);
create index audit_log_user_id_idx on public.audit_log (user_id, created_at);
create index consents_user_purpose_idx on public.consents (user_id, purpose, created_at);
create index devices_user_id_idx on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger candidate_profiles_set_updated_at before update on public.candidate_profiles
  for each row execute function public.set_updated_at();
create trigger experiences_set_updated_at before update on public.experiences
  for each row execute function public.set_updated_at();
create trigger confirmed_facts_set_updated_at before update on public.confirmed_facts
  for each row execute function public.set_updated_at();
create trigger standard_answers_set_updated_at before update on public.standard_answers
  for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Owner-scoped CRUD: select/insert/update/delete only on rows the caller owns.
do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_profiles', 'experiences', 'educations', 'languages', 'confirmed_facts',
    'cv_tracks', 'cv_versions', 'salary_rules', 'standard_answers', 'company_blocklist',
    'job_matches', 'applications', 'evidences', 'email_threads', 'application_events',
    'application_packages', 'pending_questions', 'approvals', 'email_drafts',
    'gmail_connections', 'conversations', 'messages', 'consents', 'devices'
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

-- Billing state and usage limits are enforced by the backend: users read their own rows,
-- writes go through service_role only (otherwise a user could raise their own plan or quota).
alter table public.subscriptions enable row level security;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on table public.subscriptions from anon, authenticated;
revoke all on table public.subscriptions from anon;

alter table public.usage_counters enable row level security;
create policy usage_counters_select_own on public.usage_counters
  for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on table public.usage_counters from anon, authenticated;
revoke all on table public.usage_counters from anon;

-- audit_log is append-only. Users can read and append their own entries; nobody updates or deletes
-- through the API. The LGPD purge routine (P6) will be a controlled exception owned by postgres.
alter table public.audit_log enable row level security;
create policy audit_log_select_own on public.audit_log
  for select to authenticated using ((select auth.uid()) = user_id);
create policy audit_log_insert_own on public.audit_log
  for insert to authenticated with check ((select auth.uid()) = user_id);
revoke update, delete, truncate on table public.audit_log from anon, authenticated, service_role;
revoke all on table public.audit_log from anon;

-- job_postings is global public data: authenticated users read, service_role writes.
alter table public.job_postings enable row level security;
create policy job_postings_select_authenticated on public.job_postings
  for select to authenticated using (true);
revoke insert, update, delete, truncate on table public.job_postings from anon, authenticated;
revoke all on table public.job_postings from anon;

-- Stripe webhook idempotency: server only.
alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
