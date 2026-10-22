-- P3.1/P3.2 tracker writes (spec 9.4, F10 CA10.2).
-- The transition rules live in packages/core/status.ts; these functions only make the write
-- atomic: the application row and its application_event change together or not at all.
-- security invoker: every statement runs under the caller's RLS. Referenced evidences and
-- e-mail threads must belong to the caller (FKs alone do not enforce the same owner).

create or replace function public.change_application_status(
  p_application_id uuid,
  p_from public.application_status,
  p_to public.application_status,
  p_source public.event_source,
  p_confidence numeric default null,
  p_payload jsonb default '{}'::jsonb,
  p_email_thread_id uuid default null,
  p_evidence_id uuid default null
)
returns public.application_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.application_events;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_evidence_id is not null and not exists (
    select 1 from public.evidences e
    where e.id = p_evidence_id and e.user_id = v_uid and e.application_id = p_application_id
  ) then
    raise exception 'evidence_not_found' using errcode = 'P0002';
  end if;

  if p_email_thread_id is not null and not exists (
    select 1 from public.email_threads t
    where t.id = p_email_thread_id and t.user_id = v_uid
  ) then
    raise exception 'email_thread_not_found' using errcode = 'P0002';
  end if;

  update public.applications a
  set status = p_to,
      applied_at = case
        when a.applied_at is null and p_to = 'enviada' then now()
        else a.applied_at
      end
  where a.id = p_application_id and a.user_id = v_uid and a.status = p_from;

  if not found then
    if exists (
      select 1 from public.applications a where a.id = p_application_id and a.user_id = v_uid
    ) then
      raise exception 'status_conflict' using errcode = 'P0001';
    end if;
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;

  insert into public.application_events (
    user_id, application_id, type, from_status, to_status, source, confidence, payload,
    email_thread_id, evidence_id
  ) values (
    v_uid, p_application_id, 'status_change', p_from, p_to, p_source, p_confidence,
    coalesce(p_payload, '{}'::jsonb), p_email_thread_id, p_evidence_id
  )
  returning * into v_event;

  return v_event;
end;
$$;

-- Sets or clears the next action and deadline, with a `deadline_set` event.
create or replace function public.set_application_next_action(
  p_application_id uuid,
  p_next_action text,
  p_due_at timestamptz,
  p_source public.event_source default 'usuario'
)
returns public.application_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.application_events;
  v_action text := nullif(btrim(coalesce(p_next_action, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.applications a
  set next_action = v_action,
      next_action_due_at = case when v_action is null then null else p_due_at end
  where a.id = p_application_id and a.user_id = v_uid;

  if not found then
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;

  insert into public.application_events (user_id, application_id, type, source, payload)
  values (
    v_uid, p_application_id, 'deadline_set', p_source,
    jsonb_build_object(
      'action', v_action,
      'due_at', case when v_action is null then null else p_due_at end
    )
  )
  returning * into v_event;

  return v_event;
end;
$$;

-- "Feito" on the actions page (P3.2): clears the pending action and records what was done.
create or replace function public.complete_application_action(
  p_application_id uuid,
  p_source public.event_source default 'usuario'
)
returns public.application_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.application_events;
  v_action text;
  v_due timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select a.next_action, a.next_action_due_at into v_action, v_due
  from public.applications a
  where a.id = p_application_id and a.user_id = v_uid
  for update;

  if not found then
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;
  if v_action is null then
    raise exception 'no_pending_action' using errcode = 'P0001';
  end if;

  update public.applications a
  set next_action = null, next_action_due_at = null
  where a.id = p_application_id and a.user_id = v_uid;

  insert into public.application_events (user_id, application_id, type, source, payload)
  values (
    v_uid, p_application_id, 'deadline_set', p_source,
    jsonb_build_object('action', v_action, 'due_at', v_due, 'done', true)
  )
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.change_application_status(
  uuid, public.application_status, public.application_status, public.event_source, numeric,
  jsonb, uuid, uuid
) from public, anon;
revoke all on function public.set_application_next_action(
  uuid, text, timestamptz, public.event_source
) from public, anon;
revoke all on function public.complete_application_action(uuid, public.event_source)
  from public, anon;

grant execute on function public.change_application_status(
  uuid, public.application_status, public.application_status, public.event_source, numeric,
  jsonb, uuid, uuid
) to authenticated;
grant execute on function public.set_application_next_action(
  uuid, text, timestamptz, public.event_source
) to authenticated;
grant execute on function public.complete_application_action(uuid, public.event_source)
  to authenticated;
