-- P6.4: account deletion pipeline (≤15 days, spec 12).
create table public.account_deletion_requests (
  user_id uuid primary key references auth.users on delete cascade,
  requested_at timestamptz not null default now(),
  scheduled_purge_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'cancelled')),
  completed_at timestamptz
);

alter table public.account_deletion_requests enable row level security;
create policy account_deletion_select_own on public.account_deletion_requests
  for select using ((select auth.uid()) = user_id);
create policy account_deletion_insert_own on public.account_deletion_requests
  for insert with check ((select auth.uid()) = user_id);
create policy account_deletion_update_own on public.account_deletion_requests
  for update using ((select auth.uid()) = user_id);
revoke all on table public.account_deletion_requests from anon;

-- LGPD export jobs (metadata only; ZIP lives in storage exports bucket).
create table public.privacy_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index privacy_exports_user_created_idx on public.privacy_exports (user_id, created_at desc);

alter table public.privacy_exports enable row level security;
create policy privacy_exports_select_own on public.privacy_exports
  for select using ((select auth.uid()) = user_id);
create policy privacy_exports_insert_own on public.privacy_exports
  for insert with check ((select auth.uid()) = user_id);
revoke update, delete, truncate on table public.privacy_exports from anon, authenticated;
