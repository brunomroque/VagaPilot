-- P1: profile, CVs and confirmed facts (spec F1/F1A, F2, F3, 9.3, 12.3).

-- ---------------------------------------------------------------------------
-- Wrapped data-encryption keys (envelope encryption, 12.3)
-- ---------------------------------------------------------------------------

-- One wrapped DEK per user. Server only: the app inserts if absent and never overwrites
-- (replacing a DEK would orphan every ciphertext). Deleting the row is crypto-shredding;
-- the FK cascade shreds the key when the auth user is deleted.
create table public.user_keys (
  user_id uuid primary key references auth.users on delete cascade,
  wrapped_dek bytea not null,
  key_id text not null,
  created_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;
revoke all on table public.user_keys from anon, authenticated;
-- Insert-if-absent and delete only: a wrapped key is never rewritten in place.
revoke update, truncate on table public.user_keys from service_role;

-- ---------------------------------------------------------------------------
-- languages: optional CEFR level next to the PT label (RF1.2, RF1A.3)
-- ---------------------------------------------------------------------------

alter table public.languages add column cefr text;
alter table public.languages add constraint languages_cefr_check
  check (cefr is null or cefr in ('A1','A2','B1','B2','C1','C2'));

-- ---------------------------------------------------------------------------
-- confirmed_facts: status lookups and confirmed-only semantic search (10.2, P1.3)
-- ---------------------------------------------------------------------------

create index confirmed_facts_user_status_idx on public.confirmed_facts (user_id, status);

-- search_facts(userId, query, k): ALWAYS restricted to status = 'confirmado'.
-- security invoker, so RLS still scopes rows to the caller when used with a user session.
create or replace function public.search_confirmed_facts(
  p_user_id uuid,
  p_query extensions.vector(1536),
  p_k int default 8
)
returns table (
  id uuid,
  experience_id uuid,
  statement text,
  statement_en text,
  kind text,
  tags text[],
  status public.fact_status,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.id,
    f.experience_id,
    f.statement,
    f.statement_en,
    f.kind,
    f.tags,
    f.status,
    1 - (f.embedding operator(extensions.<=>) p_query) as similarity
  from public.confirmed_facts f
  where f.user_id = p_user_id
    and f.status = 'confirmado'
    and f.embedding is not null
  order by f.embedding operator(extensions.<=>) p_query
  limit least(greatest(coalesce(p_k, 8), 1), 50);
$$;

revoke all on function public.search_confirmed_facts(uuid, extensions.vector, int) from public, anon;
grant execute on function public.search_confirmed_facts(uuid, extensions.vector, int) to authenticated, service_role;
