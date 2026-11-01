-- Spec 12.3 ("Tokens OAuth so no servidor"): 20261023130000_authenticated_table_grants.sql
-- granted table-level SELECT on public.gmail_connections to authenticated, exposing
-- refresh_token_enc to the row owner and undoing the column-level grant from p4_gmail.
-- Revoke table-level access and re-grant SELECT only on non-secret columns.

revoke all on table public.gmail_connections from anon, authenticated;

grant select (
  user_id,
  google_email,
  scopes,
  last_synced_at,
  status,
  connected_at,
  last_error
) on table public.gmail_connections to authenticated;
