-- Private buckets (spec 12.3). Objects live under {user_id}/... and are only reachable by their owner.
-- Downloads go through short-lived signed URLs created by the server.

insert into storage.buckets (id, name, public)
values
  ('cvs', 'cvs', false),
  ('evidences', 'evidences', false),
  ('exports', 'exports', false)
on conflict (id) do update set public = false;

create policy "private_buckets_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('cvs', 'evidences', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "private_buckets_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('cvs', 'evidences')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "private_buckets_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('cvs', 'evidences')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('cvs', 'evidences')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Exports are written by the server (service_role); the owner may read and delete them.
create policy "private_buckets_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('cvs', 'evidences', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
