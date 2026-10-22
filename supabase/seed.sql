-- Local seed. FICTITIOUS people only (spec rule: never real personal data).
-- Users:
--   Marina Alves  marina@vagapilot.test  senha: Ficticia#2026
--   Rafael Souza  rafael@vagapilot.test  senha: Ficticia#2026
-- Both already accepted termos/privacidade v1, so they land on /app after login.

do $$
declare
  u record;
  v_experience uuid;
  v_track uuid;
  v_cv uuid;
  v_posting uuid;
  v_match uuid;
  v_application uuid;
  v_evidence uuid;
  v_thread uuid;
  v_conversation uuid;
begin
  for u in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'marina@vagapilot.test', 'Marina Alves', 'Marina', 'Alves', 'Engineering Manager'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'rafael@vagapilot.test', 'Rafael Souza', 'Rafael', 'Souza', 'Head de Dados')
    ) as t(id, email, display_name, first_name, last_name, headline)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Ficticia#2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', u.display_name),
      now(), now(), '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now()
    );

    insert into public.candidate_profiles (user_id, display_name, first_name, last_name, email_contact, city, state)
    values (u.id, u.display_name, u.first_name, u.last_name, u.email, 'São Paulo', 'SP');

    insert into public.experiences (user_id, company, title, employment_type, start_date, is_current, location)
    values (u.id, 'Empresa Fictícia S.A.', u.headline, 'clt', '2021-03-01', true, 'São Paulo · Híbrido')
    returning id into v_experience;

    insert into public.educations (user_id, institution, degree, field, level, status)
    values (u.id, 'Universidade Exemplo', 'Bacharelado', 'Ciência da Computação', 'graduacao', 'concluido');

    insert into public.languages (user_id, language, level) values (u.id, 'Inglês', 'avancado');

    insert into public.confirmed_facts (user_id, experience_id, statement, kind, status, source, confirmed_at)
    values (u.id, v_experience, 'Liderei a migração de 40 serviços para Kubernetes.', 'conquista', 'confirmado', 'manual', now());

    insert into public.cv_tracks (user_id, name, keywords)
    values (u.id, 'Executivo & Híbrido', array['liderança', 'plataforma'])
    returning id into v_track;

    insert into public.cv_versions (user_id, track_id, language, label, is_default, storage_path, file_sha256, origin)
    values (u.id, v_track, 'pt-BR', 'Executivo & Híbrido', true, u.id::text || '/executivo-pt.pdf', repeat('0', 64), 'upload')
    returning id into v_cv;

    insert into public.salary_rules (user_id, seniority, regime, amount_min, amount_target)
    values (u.id, 'gerente', 'clt', 28000, 32000);

    insert into public.standard_answers (user_id, key, question_examples, answer)
    values (u.id, 'availability', array['Qual sua disponibilidade para início?'], 'Disponível em 30 dias.');

    insert into public.company_blocklist (user_id, company_name, normalized_name, domains, reason)
    values (u.id, 'Acme Ltda.', 'acme', array['acme.com.br'], 'Empregador atual');

    insert into public.job_postings (canonical_url, source, company, company_normalized, title, seniority, location, work_model)
    values (
      'https://vagas.exemplo.test/' || u.first_name || '/engineering-manager', 'greenhouse', 'Nubank', 'nubank',
      'Engineering Manager', 'gerente', 'São Paulo', 'hibrido'
    )
    returning id into v_posting;

    insert into public.job_matches (user_id, job_posting_id, fit, fit_score, decision)
    values (u.id, v_posting, 'alto', 94, 'aplicar')
    returning id into v_match;

    insert into public.applications (user_id, job_match_id, job_posting_id, company, role_title, source, route, status, cv_version_id, next_action)
    values (u.id, v_match, v_posting, 'Nubank', 'Engineering Manager', 'greenhouse', 'manual', 'enviada', v_cv, 'Aguardar retorno')
    returning id into v_application;

    insert into public.evidences (user_id, application_id, kind, text_excerpt)
    values (u.id, v_application, 'protocol_text', 'Candidatura recebida. Protocolo FICT-0001.')
    returning id into v_evidence;

    insert into public.email_threads (user_id, gmail_thread_id, gmail_message_id, from_domain, subject, received_at, snippet, classification, confidence, application_id)
    values (u.id, 'thread-' || u.first_name, 'msg-' || u.first_name, 'exemplo.test', 'Recebemos sua candidatura', now(), 'Obrigado pelo interesse.', 'confirmacao', 0.95, v_application)
    returning id into v_thread;

    insert into public.application_events (user_id, application_id, type, from_status, to_status, source, email_thread_id, evidence_id)
    values (u.id, v_application, 'status_change', 'rascunho', 'enviada', 'usuario', v_thread, v_evidence);

    insert into public.application_packages (user_id, application_id, payload_enc, cv_version_id, expires_at)
    values (u.id, v_application, '\x00'::bytea, v_cv, now() + interval '24 hours');

    insert into public.pending_questions (user_id, application_id, question_text, field_type)
    values (u.id, v_application, 'Você tem disponibilidade para viagens?', 'text');

    insert into public.approvals (user_id, kind, application_id, subject_ref, preview, preview_sha256, expires_at)
    values (u.id, 'enviar_email', v_application, '{}'::jsonb, '{}'::jsonb, repeat('0', 64), now() + interval '24 hours');

    insert into public.email_drafts (user_id, application_id, to_addresses, subject, body_md)
    values (u.id, v_application, array['recrutamento@exemplo.test'], 'Candidatura', 'Olá, segue meu currículo.');

    insert into public.gmail_connections (user_id, google_email, scopes, refresh_token_enc)
    values (u.id, u.email, array['https://www.googleapis.com/auth/gmail.readonly'], '\x00'::bytea);

    insert into public.conversations (user_id, title) values (u.id, 'Primeira conversa')
    returning id into v_conversation;

    insert into public.messages (user_id, conversation_id, role, parts)
    values (u.id, v_conversation, 'user', '[{"type":"text","text":"Olá"}]'::jsonb);

    insert into public.audit_log (user_id, actor, action, target_type)
    values (u.id, 'sistema', 'seed.created', 'user');

    insert into public.consents (user_id, purpose, version, granted)
    values (u.id, 'termos', 'v1', true), (u.id, 'privacidade', 'v1', true);

    insert into public.device_pairing_codes (code, user_id, expires_at)
    values (
      case u.first_name when 'Marina' then '100001' else '200002' end,
      u.id,
      now() + interval '30 days'
    );

    insert into public.devices (user_id, name, token_hash) values (u.id, 'Chrome fictício', repeat('0', 64));

    insert into public.subscriptions (user_id, plan, status) values (u.id, 'pro', 'trialing');

    insert into public.usage_counters (user_id, period, metric, value) values (u.id, '2026-10', 'analises', 18);
  end loop;
end;
$$;
