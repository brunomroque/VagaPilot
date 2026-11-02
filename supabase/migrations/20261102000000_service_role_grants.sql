-- Later migrations created tables after 20261023130000_authenticated_table_grants.sql ran
-- "grant all on all tables". In PostgreSQL that only covers tables that existed then;
-- new tables got RLS enabled but service_role had no table privileges. The admin client
-- (service_role) then fails on legal_documents, legal_acceptances, apply_runs, etc., and
-- the app showed "Rascunho jurídico" because loadCurrentLegalDocuments returned {}.

do $$
declare
  t text;
begin
  foreach t in array array[
    'agent_permission_events',
    'agent_permission_prefs',
    'agent_permission_rules',
    'agent_permissions',
    'app_admins',
    'apply_consent_decisions',
    'apply_run_outcomes',
    'apply_runs',
    'ats_credentials',
    'ats_recipes',
    'browser_auth_states',
    'browser_login_sessions',
    'browser_providers',
    'browser_sessions',
    'chat_record_links',
    'cv_parsed',
    'legal_acceptances',
    'legal_documents',
    'pairing_code_attempts',
    'pairing_ip_attempts',
    'platform_profiles',
    'site_risk_levels'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        t
      );
    end if;
  end loop;
end $$;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
