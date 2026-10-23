-- QA: longer pairing codes, attempt lockout, search-pass column, and tighter grants.
-- Spec 11.3 (pairing), §12 (deletion), §14 (plans). Authenticated users keep the reads
-- the app needs. Writes that only the server performs are revoked.

-- Pairing codes: drop leftover 6-digit rows (TTL is 10 min) before tightening the check.
delete from public.device_pairing_codes
where code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$';

alter table public.device_pairing_codes
  drop constraint if exists device_pairing_codes_code_check;

alter table public.device_pairing_codes
  add constraint device_pairing_codes_code_check
  check (code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$');

alter table public.device_pairing_codes add column failed_attempts integer not null default 0;

create table public.pairing_ip_attempts (
  ip text primary key,
  attempts integer not null,
  window_started_at timestamptz not null
);

create table public.pairing_code_attempts (
  code text primary key,
  attempts integer not null,
  window_started_at timestamptz not null
);

alter table public.pairing_ip_attempts enable row level security;
alter table public.pairing_code_attempts enable row level security;
revoke all on table public.pairing_ip_attempts from anon, authenticated;
revoke all on table public.pairing_code_attempts from anon, authenticated;

-- CV extraction failure is stored so the UI can explain a scanned PDF.
alter table public.cv_versions add column extraction_error text;

-- Devices and pairing codes are written by the server (service role) during pairing.
drop policy if exists devices_insert_own on public.devices;
drop policy if exists devices_update_own on public.devices;
drop policy if exists devices_delete_own on public.devices;
revoke insert, update, delete, truncate on table public.devices from authenticated;

drop policy if exists device_pairing_codes_insert on public.device_pairing_codes;
drop policy if exists device_pairing_codes_delete on public.device_pairing_codes;
revoke insert, update, delete, truncate on table public.device_pairing_codes from authenticated;

-- Account deletion: the user cannot rewrite status or scheduled_purge_at.
-- Request and cancel go through service role (POST/DELETE /api/privacy/delete).
drop policy if exists account_deletion_insert_own on public.account_deletion_requests;
drop policy if exists account_deletion_update_own on public.account_deletion_requests;
revoke insert, update, delete, truncate on table public.account_deletion_requests from authenticated;

-- Consents stay insertable by the signed-in user (they grant consent). History is append-only.
drop policy if exists consents_update_own on public.consents;
drop policy if exists consents_delete_own on public.consents;
revoke update, delete, truncate on table public.consents from authenticated;

-- Audit log is written by the server. Authenticated users only read their rows.
drop policy if exists audit_log_insert_own on public.audit_log;
revoke insert, update, delete, truncate on table public.audit_log from authenticated;

-- Privacy export metadata is created by the server.
drop policy if exists privacy_exports_insert_own on public.privacy_exports;
revoke insert, update, delete, truncate on table public.privacy_exports from authenticated;

-- devices left the owner-CRUD loop; keep RLS enabled (schema-sync looks for this statement).
alter table public.devices enable row level security;

-- Recreate chat policies with (select auth.uid()) for databases that applied the earlier form.
drop policy if exists chat_record_links_select on public.chat_record_links;
drop policy if exists chat_record_links_insert on public.chat_record_links;
drop policy if exists chat_record_links_update on public.chat_record_links;
drop policy if exists chat_record_links_delete on public.chat_record_links;
create policy chat_record_links_select on public.chat_record_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy chat_record_links_insert on public.chat_record_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chat_record_links_update on public.chat_record_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chat_record_links_delete on public.chat_record_links
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists platform_profiles_select on public.platform_profiles;
drop policy if exists platform_profiles_insert on public.platform_profiles;
drop policy if exists platform_profiles_update on public.platform_profiles;
drop policy if exists platform_profiles_delete on public.platform_profiles;
create policy platform_profiles_select on public.platform_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy platform_profiles_insert on public.platform_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy platform_profiles_update on public.platform_profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy platform_profiles_delete on public.platform_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

