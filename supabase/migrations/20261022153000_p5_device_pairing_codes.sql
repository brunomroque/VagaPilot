-- P5: ephemeral 6-digit codes to pair the Chrome extension (spec 11.3, 10 min TTL).

create table public.device_pairing_codes (
  code text primary key check (code ~ '^\d{6}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index device_pairing_codes_user_id_idx on public.device_pairing_codes (user_id);
create index device_pairing_codes_expires_at_idx on public.device_pairing_codes (expires_at);

alter table public.device_pairing_codes enable row level security;

create policy device_pairing_codes_select on public.device_pairing_codes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy device_pairing_codes_insert on public.device_pairing_codes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy device_pairing_codes_delete on public.device_pairing_codes
  for delete to authenticated
  using ((select auth.uid()) = user_id);
