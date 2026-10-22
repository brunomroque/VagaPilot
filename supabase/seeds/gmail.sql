-- Gmail seed (P4). FICTITIOUS in-app notifications for the two seed users (Marina and Rafael),
-- so every owner-scoped table has rows for the RLS isolation tests. Already read, so the bell
-- starts quiet. Idempotent: fixed ids + `on conflict do nothing`; safe to run on a live database
-- (`psql -f supabase/seeds/gmail.sql`).

insert into public.notifications (id, user_id, kind, params, dedupe_key, read_at, created_at)
select v.id, v.user_id, v.kind, v.params, v.dedupe_key, now() - interval '1 day', now() - interval '1 day'
from (values
  ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
    'status_changed', '{"company": "Stone", "to": "entrevista"}'::jsonb, 'seed:status'),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
    'status_changed', '{"company": "Empresa Exemplo", "to": "em_analise"}'::jsonb, 'seed:status')
) as v(id, user_id, kind, params, dedupe_key)
where exists (select 1 from auth.users u where u.id = v.user_id)
on conflict do nothing;
