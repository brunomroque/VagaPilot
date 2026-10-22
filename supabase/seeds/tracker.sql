-- Tracker seed (P3). FICTITIOUS processes for the fictitious user Marina Alves.
-- Companies are the placeholder brands of the Figma prototype; every process, date, e-mail and
-- protocol is invented. Idempotent: fixed ids + `on conflict do nothing`, so it can run again on
-- a live database (`psql -f supabase/seeds/tracker.sql`) without `db reset`.

do $$
declare
  v_user constant uuid := '11111111-1111-4111-8111-111111111111';
  v_cv uuid;
  r record;
begin
  if not exists (select 1 from auth.users where id = v_user) then
    return;
  end if;

  select id into v_cv from public.cv_versions
  where user_id = v_user
  order by is_default desc nulls last, created_at
  limit 1;

  for r in
    select * from (values
      -- id suffix, company, role, source, route, status, fit, score, regime, location,
      -- created days ago, applied days ago, next action, due (hours from now)
      (1, 'Alice', 'Head of Technology', 'gupy', 'extensao', 'rascunho', 'alto', 87, 'clt',
        'São Paulo · Presencial', 1, null::int, 'Decidir se vale aplicar (modelo presencial)', 30),
      (2, 'Loft', 'Gerente de Plataforma', 'inhire', 'extensao', 'enviada', 'alto', 82, 'pj',
        'Remoto · Brasil', 4, 2, null, null),
      (3, 'iFood', 'Tech Lead Manager', 'greenhouse', 'email', 'em_analise', 'alto', 91, 'clt',
        'Osasco · Híbrido', 9, 6, null, null),
      (4, 'QuintoAndar', 'Engineering Manager', 'lever', 'extensao', 'etapa_pendente', 'alto', 89,
        'clt', 'São Paulo · Híbrido', 14, 9, 'Concluir teste de liderança', 20),
      (5, 'Stone', 'Diretora de Engenharia', 'indicacao', 'manual', 'entrevista', 'alto', 96, 'clt',
        'São Paulo · Híbrido', 18, 12, 'Preparar entrevista com VP de Produto', 70),
      (6, 'Creditas', 'Head de Operações Tech', 'linkedin', 'manual', 'encerrada', 'medio', 84, 'clt',
        'São Paulo · Híbrido', 70, 60, null, null),
      (7, 'PicPay', 'Engineering Manager', 'gupy', 'extensao', 'reprovada', 'medio', 72, 'clt',
        'São Paulo · Híbrido', 30, 25, 'Pedir feedback à recrutadora', null)
    ) as t(n, company, role, source, route, status, fit, score, regime, location,
           created_ago, applied_ago, next_action, due_hours)
  loop
    insert into public.job_postings (
      id, canonical_url, source, company, company_normalized, title, location, regime
    ) values (
      ('aaaaaaaa-0000-4000-8000-1000000000' || lpad(r.n::text, 2, '0'))::uuid,
      'https://vagas.exemplo.test/marina/' || r.n,
      r.source::public.job_source, r.company, lower(r.company), r.role, r.location,
      r.regime::public.contract_regime
    ) on conflict do nothing;

    insert into public.job_matches (id, user_id, job_posting_id, fit, fit_score, decision)
    values (
      ('aaaaaaaa-0000-4000-8000-2000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
      ('aaaaaaaa-0000-4000-8000-1000000000' || lpad(r.n::text, 2, '0'))::uuid,
      r.fit::public.fit_level, r.score, case when r.status = 'rascunho' then 'salvar' else 'aplicar' end
    ) on conflict do nothing;

    insert into public.applications (
      id, user_id, job_match_id, job_posting_id, company, role_title, source, route, status,
      applied_at, cv_version_id, next_action, next_action_due_at, link, notes, salary_informed,
      created_at, updated_at
    ) values (
      ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
      ('aaaaaaaa-0000-4000-8000-2000000000' || lpad(r.n::text, 2, '0'))::uuid,
      ('aaaaaaaa-0000-4000-8000-1000000000' || lpad(r.n::text, 2, '0'))::uuid,
      r.company, r.role, r.source::public.job_source, r.route::public.application_route,
      r.status::public.application_status,
      case when r.applied_ago is null then null else now() - make_interval(days => r.applied_ago) end,
      case when r.applied_ago is null then null else v_cv end,
      r.next_action,
      case when r.due_hours is null then null else now() + make_interval(hours => r.due_hours) end,
      'https://vagas.exemplo.test/marina/' || r.n,
      'Processo fictício para demonstração.',
      case when r.applied_ago is null then null else '{"text":"R$ 30.000 CLT"}'::jsonb end,
      now() - make_interval(days => r.created_ago),
      now() - make_interval(days => coalesce(r.applied_ago, r.created_ago))
    ) on conflict do nothing;

    insert into public.application_events (
      id, user_id, application_id, type, from_status, to_status, source, payload, occurred_at
    ) values (
      ('aaaaaaaa-0000-4000-8000-4000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
      ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid,
      'status_change', null, 'rascunho', 'agente', '{"created": true}'::jsonb,
      now() - make_interval(days => r.created_ago)
    ) on conflict do nothing;

    if r.applied_ago is not null then
      insert into public.application_events (
        id, user_id, application_id, type, from_status, to_status, source, payload, occurred_at
      ) values (
        ('aaaaaaaa-0000-4000-8000-5000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
        ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid,
        'status_change', 'rascunho', 'enviada',
        case when r.route = 'extensao' then 'extensao' else 'usuario' end::public.event_source,
        '{}'::jsonb, now() - make_interval(days => r.applied_ago)
      ) on conflict do nothing;
    end if;

    if r.status not in ('rascunho', 'enviada') then
      insert into public.email_threads (
        id, user_id, gmail_thread_id, gmail_message_id, from_domain, subject, received_at, snippet,
        classification, confidence, application_id
      ) values (
        ('aaaaaaaa-0000-4000-8000-6000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
        'seed-thread-' || r.n, 'seed-msg-' || r.n, 'exemplo.test',
        case r.status
          when 'etapa_pendente' then 'Próxima etapa: teste on-line'
          when 'entrevista' then 'Convite para entrevista'
          when 'reprovada' then 'Retorno sobre sua candidatura'
          when 'encerrada' then 'Vaga encerrada'
          else 'Recebemos sua candidatura'
        end,
        now() - make_interval(days => greatest(coalesce(r.applied_ago, 1) - 2, 0)),
        'Mensagem fictícia de exemplo.',
        case r.status
          when 'etapa_pendente' then 'teste_etapa'
          when 'entrevista' then 'convite_entrevista'
          when 'reprovada' then 'reprovacao'
          else 'confirmacao'
        end::public.email_class,
        0.93,
        ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid
      ) on conflict do nothing;

      insert into public.evidences (id, user_id, application_id, kind, text_excerpt, created_at)
      values (
        ('aaaaaaaa-0000-4000-8000-7000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
        ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid,
        'email', 'Trecho fictício do e-mail recebido.',
        now() - make_interval(days => greatest(coalesce(r.applied_ago, 1) - 2, 0))
      ) on conflict do nothing;

      insert into public.application_events (
        id, user_id, application_id, type, from_status, to_status, source, confidence, payload,
        email_thread_id, evidence_id, occurred_at
      ) values (
        ('aaaaaaaa-0000-4000-8000-8000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
        ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid,
        'status_change', 'enviada', r.status::public.application_status,
        case when r.status = 'encerrada' then 'usuario' else 'gmail' end::public.event_source,
        case when r.status = 'encerrada' then null else 0.93 end,
        '{}'::jsonb,
        ('aaaaaaaa-0000-4000-8000-6000000000' || lpad(r.n::text, 2, '0'))::uuid,
        ('aaaaaaaa-0000-4000-8000-7000000000' || lpad(r.n::text, 2, '0'))::uuid,
        now() - make_interval(days => greatest(coalesce(r.applied_ago, 1) - 2, 0))
      ) on conflict do nothing;
    end if;

    if r.next_action is not null then
      insert into public.application_events (
        id, user_id, application_id, type, source, payload, occurred_at
      ) values (
        ('aaaaaaaa-0000-4000-8000-9000000000' || lpad(r.n::text, 2, '0'))::uuid, v_user,
        ('aaaaaaaa-0000-4000-8000-3000000000' || lpad(r.n::text, 2, '0'))::uuid,
        'deadline_set', case when r.status = 'etapa_pendente' then 'gmail' else 'usuario' end::public.event_source,
        jsonb_build_object(
          'action', r.next_action,
          'due_at', case when r.due_hours is null then null else now() + make_interval(hours => r.due_hours) end
        ),
        now() - interval '1 day'
      ) on conflict do nothing;
    end if;
  end loop;
end;
$$;
