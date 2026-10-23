-- PostgREST needs table-level GRANTs; RLS policies are not enough.
-- Hosted projects that received schema via SQL migrations may lack Supabase's default grants.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.candidate_profiles,
  public.experiences,
  public.educations,
  public.languages,
  public.confirmed_facts,
  public.cv_tracks,
  public.cv_versions,
  public.salary_rules,
  public.standard_answers,
  public.company_blocklist,
  public.job_matches,
  public.applications,
  public.evidences,
  public.email_threads,
  public.application_events,
  public.application_packages,
  public.pending_questions,
  public.approvals,
  public.email_drafts,
  public.conversations,
  public.messages,
  public.consents,
  public.devices,
  public.device_pairing_codes,
  public.notifications,
  public.saved_searches,
  public.job_ingestions,
  public.excluded_companies,
  public.preferences,
  public.user_settings,
  public.memory_events,
  public.account_deletion_requests,
  public.privacy_exports
to authenticated;

grant select on table
  public.subscriptions,
  public.usage_counters,
  public.gmail_connections
to authenticated;

grant select, insert on table public.audit_log to authenticated;

grant select on table public.job_postings to authenticated;

grant all on all tables in schema public to service_role;
