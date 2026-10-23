/**
 * Access model per table, as enforced by RLS in supabase/migrations.
 * The RLS isolation tests iterate these lists, so every table must appear in exactly one.
 */

/** select/insert/update/delete only where user_id = auth.uid(). */
export const ownerCrudTables = [
  "candidate_profiles",
  "experiences",
  "educations",
  "languages",
  "confirmed_facts",
  "cv_tracks",
  "cv_versions",
  "salary_rules",
  "standard_answers",
  "company_blocklist",
  "job_matches",
  "applications",
  "evidences",
  "email_threads",
  "application_events",
  "application_packages",
  "pending_questions",
  "approvals",
  "email_drafts",
  "conversations",
  "messages",
  "consents",
  "notifications",
  "saved_searches",
  "job_ingestions",
  "excluded_companies",
  "preferences",
  "user_settings",
  "memory_events",
] as const

/**
 * Owner reads; writes only through service_role (billing, quota and the Gmail connection,
 * whose OAuth token column is not even readable by the owner).
 */
export const ownerReadOnlyTables = [
  "subscriptions",
  "usage_counters",
  "gmail_connections",
  "devices",
  "device_pairing_codes",
  "account_deletion_requests",
  "privacy_exports",
  "audit_log",
] as const

/** Audit writes go through service_role. The list stays so callers can spread it. */
export const appendOnlyTables = [] as const

/** Global public data: authenticated reads, service_role writes. */
export const globalReadTables = ["job_postings"] as const

/** No client access at all. */
export const serverOnlyTables = [
  "stripe_events",
  "user_keys",
  "pairing_ip_attempts",
  "pairing_code_attempts",
  "app_admins",
  "apply_runs",
  "browser_auth_states",
] as const

/** Readable/writable only by app admins (public.is_app_admin()); service_role writes sessions. */
export const adminTables = ["browser_providers", "browser_sessions"] as const

export type OwnerCrudTable = (typeof ownerCrudTables)[number]
export type TableName =
  | OwnerCrudTable
  | (typeof ownerReadOnlyTables)[number]
  | (typeof appendOnlyTables)[number]
  | (typeof globalReadTables)[number]
  | (typeof serverOnlyTables)[number]
  | (typeof adminTables)[number]

/** Tables whose primary key is user_id (one row per user). */
export const userKeyedTables = [
  "candidate_profiles",
  "gmail_connections",
  "subscriptions",
  "user_settings",
] as const satisfies readonly TableName[]

export const privateBuckets = ["cvs", "evidences", "exports"] as const
