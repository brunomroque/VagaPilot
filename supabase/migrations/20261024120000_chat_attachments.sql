-- Chat attachments (F7 / F14): files linked to conversations and messages.

alter table public.cv_versions
  add column if not exists source_message_id uuid references public.messages (id) on delete set null;

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  kind text not null check (kind in ('cv', 'job_image', 'job_document')),
  mime_type text not null,
  file_name text not null,
  storage_path text not null,
  file_sha256 text not null,
  cv_version_id uuid references public.cv_versions (id) on delete set null,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_attachments_user_id_idx on public.chat_attachments (user_id);
create index if not exists chat_attachments_conversation_id_idx on public.chat_attachments (conversation_id);

alter table public.chat_attachments enable row level security;

create policy "chat_attachments_owner" on public.chat_attachments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.chat_attachments to authenticated;

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do update set public = false;

create policy "chat_attachments_bucket_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "chat_attachments_bucket_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "chat_attachments_bucket_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "chat_attachments_bucket_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
