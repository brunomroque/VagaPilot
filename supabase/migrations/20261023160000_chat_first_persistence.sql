-- Chat-first: conversations metadata, chat_record_links, platform_profiles, fact usage, ATS, approvals.

alter table public.conversations
  add column if not exists updated_at timestamptz default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists context jsonb default '{}'::jsonb,
  add column if not exists last_message_at timestamptz;

alter table public.messages
  add column if not exists tool_names text[],
  add column if not exists model text;

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

create table if not exists public.chat_record_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  message_id uuid references public.messages on delete set null,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('created', 'updated')),
  created_at timestamptz not null default now()
);

create index chat_record_links_user_record_idx
  on public.chat_record_links (user_id, table_name, record_id);

create table if not exists public.platform_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  platform text not null,
  url text,
  last_updated_at timestamptz,
  outdated boolean not null default false,
  outdated_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

alter table public.confirmed_facts
  add column if not exists usage text not null default 'cv_relevant'
    check (usage in ('cv_relevant', 'form_only'));

alter table public.job_matches
  add column if not exists ats jsonb;

alter type public.approval_kind add value 'cv_change';
alter type public.approval_kind add value 'fact_save';
alter type public.approval_kind add value 'application_submit';
alter type public.approval_kind add value 'profile_change';
alter type public.approval_kind add value 'destructive';

alter table public.memory_events drop constraint if exists memory_events_intent_check;
alter table public.memory_events
  add constraint memory_events_intent_check
  check (intent in (
    'create_saved_search', 'update_saved_search', 'delete_saved_search',
    'add_excluded_company', 'remove_excluded_company', 'update_language_level',
    'set_salary_rules', 'set_preference', 'set_approval_mode', 'gap'
  ));

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.chat_record_links enable row level security;
alter table public.platform_profiles enable row level security;

create policy chat_record_links_select on public.chat_record_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy chat_record_links_insert on public.chat_record_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chat_record_links_update on public.chat_record_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chat_record_links_delete on public.chat_record_links
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy platform_profiles_select on public.platform_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy platform_profiles_insert on public.platform_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy platform_profiles_update on public.platform_profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy platform_profiles_delete on public.platform_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.chat_record_links to authenticated;
grant select, insert, update, delete on public.platform_profiles to authenticated;
