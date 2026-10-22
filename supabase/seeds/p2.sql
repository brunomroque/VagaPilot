-- P2 seed: F14 settings for the FICTITIOUS users Marina and Rafael (one row per new table, so
-- the RLS isolation tests have data for both). Idempotent (fixed ids + on conflict do nothing):
-- `psql -f supabase/seeds/p2.sql` runs on a live database without `db reset`.

do $$
declare
  u record;
  v_search uuid;
begin
  for u in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'a'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'b')
    ) as t(id, tag)
  loop
    if not exists (select 1 from auth.users where id = u.id) then
      continue;
    end if;

    v_search := ('5eed0000-0000-4000-8000-00000000000' || case when u.tag = 'a' then '1' else '2' end)::uuid;

    insert into public.saved_searches (id, user_id, query, seniority, location, work_model, frequency, time_of_day)
    values (v_search, u.id, 'Engineering Manager', 'gerente', 'São Paulo', 'hibrido', 'diaria', 'manha')
    on conflict (id) do nothing;

    insert into public.excluded_companies (user_id, company_name, normalized_name)
    values (u.id, 'Empresa Excluída Fictícia', 'empresa excluida ficticia')
    on conflict (user_id, normalized_name) do nothing;

    insert into public.preferences (user_id, key, value)
    values (u.id, 'searches.min_fit', '"baixo"'::jsonb)
    on conflict (user_id, key) do nothing;

    insert into public.user_settings (user_id, approval_mode)
    values (u.id, 'pausar_antes')
    on conflict (user_id) do nothing;

    insert into public.memory_events (id, user_id, intent, origin, utterance, target_type, target_id, before, after, status)
    values (
      ('5eed0000-0000-4000-8000-00000000010' || case when u.tag = 'a' then '1' else '2' end)::uuid,
      u.id, 'create_saved_search', 'formulario', null, 'saved_search', v_search, null,
      jsonb_build_object('query', 'Engineering Manager', 'location', 'São Paulo'), 'aplicada'
    )
    on conflict (id) do nothing;

    insert into public.job_ingestions (id, user_id, batch_id, input_url, status, error_code)
    values (
      ('5eed0000-0000-4000-8000-00000000020' || case when u.tag = 'a' then '1' else '2' end)::uuid,
      u.id, '5eed0000-0000-4000-8000-000000000300'::uuid, 'https://vagas.exemplo.test/semente',
      'falhou', 'not_found'
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;
