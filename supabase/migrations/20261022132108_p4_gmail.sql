-- P4.1–P4.3 Gmail (F11 RF11.1–RF11.11, 11.2, 12.3).
-- 1. gmail_connections becomes server-written and its token column is invisible to clients.
-- 2. email_threads keeps only metadata and a snippet of at most 500 characters (CA11.4).
-- 3. notifications: in-app bell and deadline reminders (RF11.6).
-- 4. gmail_* functions: the background sync has no auth.uid(), so it writes through
--    service_role-only functions that take an explicit p_user_id and re-check ownership.

-- ---------------------------------------------------------------------------
-- gmail_connections
-- ---------------------------------------------------------------------------

alter table public.gmail_connections add column connected_at timestamptz default now();
alter table public.gmail_connections add column last_error text;
-- Claimed by one sync at a time (cron, "Sincronizar agora" and the initial load never overlap).
alter table public.gmail_connections add column sync_lock_until timestamptz;

-- "Tokens OAuth só no servidor" (12.3): connect, refresh and revoke run with service_role.
-- Users only read the non-secret columns of their own row (RLS select policy stays).
alter table public.gmail_connections enable row level security;
revoke all on table public.gmail_connections from anon, authenticated;
grant select (
  user_id, google_email, scopes, last_synced_at, status, connected_at, last_error
) on table public.gmail_connections to authenticated;

-- ---------------------------------------------------------------------------
-- email_threads
-- ---------------------------------------------------------------------------

alter table public.email_threads
  add constraint email_threads_snippet_max_500 check (snippet is null or char_length(snippet) <= 500);
alter table public.email_threads
  add constraint email_threads_review_status_check
  check (review_status in ('auto', 'revisar', 'confirmado', 'ignorado'));

create index email_threads_user_review_idx
  on public.email_threads (user_id, review_status, received_at desc);

-- ---------------------------------------------------------------------------
-- notifications (topbar bell, reminders 48 h / 12 h)
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('status_changed', 'review_needed', 'deadline_reminder', 'gmail_error')),
  params jsonb not null default '{}',
  application_id uuid references public.applications on delete cascade,
  email_thread_id uuid references public.email_threads on delete cascade,
  dedupe_key text,
  email_sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_application_id_idx on public.notifications (application_id);
create index notifications_email_thread_id_idx on public.notifications (email_thread_id);

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_insert_own on public.notifications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notifications_update_own on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notifications_delete_own on public.notifications
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.notifications from anon;

-- ---------------------------------------------------------------------------
-- Service-role writes for the Gmail sync (no auth.uid() in background jobs)
-- ---------------------------------------------------------------------------
-- security invoker + execute only for service_role. Every statement filters by p_user_id and
-- referenced rows must belong to that user, so a job can never write across users even if it
-- passes a foreign id. The transition rules live in packages/core/status.ts; these functions
-- repeat the two automatic-update invariants as a last line of defence (9.4): never leave a
-- terminal status and never apply below 0.8 confidence.

create or replace function public.gmail_change_application_status(
  p_user_id uuid,
  p_application_id uuid,
  p_from public.application_status,
  p_to public.application_status,
  p_confidence numeric,
  p_email_thread_id uuid,
  p_evidence_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.application_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.application_events;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22004';
  end if;
  if p_from in ('reprovada', 'encerrada', 'descartada') then
    raise exception 'terminal_requires_user' using errcode = 'P0001';
  end if;
  if p_confidence is null or p_confidence < 0.8 then
    raise exception 'needs_review' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.email_threads t
    where t.id = p_email_thread_id and t.user_id = p_user_id
  ) then
    raise exception 'email_thread_not_found' using errcode = 'P0002';
  end if;

  if p_evidence_id is not null and not exists (
    select 1 from public.evidences e
    where e.id = p_evidence_id and e.user_id = p_user_id and e.application_id = p_application_id
  ) then
    raise exception 'evidence_not_found' using errcode = 'P0002';
  end if;

  update public.applications a
  set status = p_to,
      last_email_at = now(),
      applied_at = case
        when a.applied_at is null and p_to = 'enviada' then now()
        else a.applied_at
      end
  where a.id = p_application_id and a.user_id = p_user_id and a.status = p_from;

  if not found then
    if exists (
      select 1 from public.applications a where a.id = p_application_id and a.user_id = p_user_id
    ) then
      raise exception 'status_conflict' using errcode = 'P0001';
    end if;
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;

  insert into public.application_events (
    user_id, application_id, type, from_status, to_status, source, confidence, payload,
    email_thread_id, evidence_id
  ) values (
    p_user_id, p_application_id, 'status_change', p_from, p_to, 'gmail', p_confidence,
    coalesce(p_payload, '{}'::jsonb), p_email_thread_id, p_evidence_id
  )
  returning * into v_event;

  return v_event;
end;
$$;

-- Deadline or interview time read from an e-mail (RF11.5, CA11.2). Source is always gmail.
create or replace function public.gmail_set_application_next_action(
  p_user_id uuid,
  p_application_id uuid,
  p_next_action text,
  p_due_at timestamptz,
  p_email_thread_id uuid
)
returns public.application_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.application_events;
  v_action text := nullif(btrim(coalesce(p_next_action, '')), '');
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22004';
  end if;
  if v_action is null then
    raise exception 'action_required' using errcode = '22004';
  end if;
  if not exists (
    select 1 from public.email_threads t
    where t.id = p_email_thread_id and t.user_id = p_user_id
  ) then
    raise exception 'email_thread_not_found' using errcode = 'P0002';
  end if;

  update public.applications a
  set next_action = v_action, next_action_due_at = p_due_at
  where a.id = p_application_id and a.user_id = p_user_id;

  if not found then
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;

  insert into public.application_events (
    user_id, application_id, type, source, payload, email_thread_id
  ) values (
    p_user_id, p_application_id, 'deadline_set', 'gmail',
    jsonb_build_object('action', v_action, 'due_at', p_due_at), p_email_thread_id
  )
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.gmail_change_application_status(
  uuid, uuid, public.application_status, public.application_status, numeric, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.gmail_set_application_next_action(
  uuid, uuid, text, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.gmail_change_application_status(
  uuid, uuid, public.application_status, public.application_status, numeric, uuid, uuid, jsonb
) to service_role;
grant execute on function public.gmail_set_application_next_action(
  uuid, uuid, text, timestamptz, uuid
) to service_role;
