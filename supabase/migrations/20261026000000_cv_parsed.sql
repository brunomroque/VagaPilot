-- CV parsing at upload (ATS-style). Purely additive: one new column and one new table.
-- The text is extracted once (OCR fallback) and stored with the language detected from it;
-- the structured JSON lives in cv_parsed, 1:1 with the CV version and deleted with it.

alter table public.cv_versions add column if not exists detected_language text;

create table if not exists public.cv_parsed (
  cv_version_id uuid primary key references public.cv_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  -- Items found in the CV that are not in the profile. Each becomes an approval card;
  -- nothing is written to the profile without the user's click.
  profile_diff jsonb not null default '[]'::jsonb,
  dismissed text[] not null default '{}',
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cv_parsed_user_id_idx on public.cv_parsed (user_id);

alter table public.cv_parsed enable row level security;
revoke all on table public.cv_parsed from anon;

create policy cv_parsed_select_own on public.cv_parsed
  for select to authenticated using ((select auth.uid()) = user_id);
create policy cv_parsed_update_own on public.cv_parsed
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy cv_parsed_delete_own on public.cv_parsed
  for delete to authenticated using ((select auth.uid()) = user_id);
