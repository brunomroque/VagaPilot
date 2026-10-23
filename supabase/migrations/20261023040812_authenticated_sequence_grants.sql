-- bigserial columns need sequence privileges. Table GRANTs do not cover them,
-- so inserts into audit_log fail with: permission denied for sequence audit_log_id_seq.
grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
