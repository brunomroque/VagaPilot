import {
  bigserial,
  boolean,
  char,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { authUsers } from "drizzle-orm/supabase"

import {
  applicationRoute,
  applicationStatus,
  approvalKind,
  approvalStatus,
  contractRegime,
  emailClass,
  employmentType,
  eventSource,
  factStatus,
  fitLevel,
  jobSource,
  seniority,
  workModel,
} from "./enums.js"

/** `_enc` columns: ciphertext produced in the application (envelope encryption, spec 12.3). */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea"
  },
})

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow()
const ownerId = () =>
  uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" })
const embedding = () => vector("embedding", { dimensions: 1536 })

// ---------------------------------------------------------------------------
// Profile and facts
// ---------------------------------------------------------------------------

export const candidateProfiles = pgTable("candidate_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  emailContact: text("email_contact"),
  phoneEnc: bytea("phone_enc"),
  city: text("city"),
  state: char("state", { length: 2 }),
  country: char("country", { length: 2 }).default("BR"),
  addressEnc: bytea("address_enc"),
  documentsEnc: bytea("documents_enc"),
  linkedinUrl: text("linkedin_url"),
  portfolioUrl: text("portfolio_url"),
  birthDateEnc: bytea("birth_date_enc"),
  diversityEnc: bytea("diversity_enc"),
  preferences: jsonb("preferences").notNull().default({}),
  locale: text("locale").notNull().default("pt-BR"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  cvFilenamePattern: text("cv_filename_pattern")
    .notNull()
    .default("CV-{first}-{last}-{lang}"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    employmentType: employmentType("employment_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").default(false),
    location: text("location"),
    description: text("description"),
    sortOrder: integer("sort_order").default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("experiences_user_id_idx").on(t.userId)]
)

export const educations = pgTable(
  "educations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    institution: text("institution").notNull(),
    degree: text("degree"),
    field: text("field"),
    level: text("level"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status"),
  },
  (t) => [index("educations_user_id_idx").on(t.userId)]
)

export const languages = pgTable(
  "languages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    language: text("language").notNull(),
    level: text("level").notNull(),
    cefr: text("cefr"),
  },
  (t) => [index("languages_user_id_idx").on(t.userId)]
)

export const confirmedFacts = pgTable(
  "confirmed_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    experienceId: uuid("experience_id").references(() => experiences.id, {
      onDelete: "set null",
    }),
    statement: text("statement").notNull(),
    statementEn: text("statement_en"),
    kind: text("kind").notNull(),
    tags: text("tags").array().default([]),
    status: factStatus("status").notNull().default("proposto"),
    source: text("source").notNull(),
    sourceRef: jsonb("source_ref"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    embedding: embedding(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("confirmed_facts_embedding_hnsw").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
    index("confirmed_facts_user_id_idx").on(t.userId),
  ]
)

export const cvTracks = pgTable(
  "cv_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    name: text("name").notNull(),
    description: text("description"),
    keywords: text("keywords").array().default([]),
  },
  (t) => [index("cv_tracks_user_id_idx").on(t.userId)]
)

export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    trackId: uuid("track_id").references(() => cvTracks.id, {
      onDelete: "set null",
    }),
    language: text("language").notNull(),
    label: text("label").notNull(),
    isDefault: boolean("is_default").default(false),
    storagePath: text("storage_path").notNull(),
    docxStoragePath: text("docx_storage_path"),
    fileSha256: text("file_sha256").notNull(),
    extractedText: text("extracted_text"),
    extractionError: text("extraction_error"),
    origin: text("origin").notNull(),
    parentVersionId: uuid("parent_version_id").references(
      (): AnyPgColumn => cvVersions.id
    ),
    factIds: uuid("fact_ids").array().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("cv_versions_user_id_idx").on(t.userId)]
)

export const salaryRules = pgTable(
  "salary_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    seniority: seniority("seniority").notNull(),
    regime: contractRegime("regime").notNull(),
    amountMin: numeric("amount_min", { precision: 12, scale: 2 }),
    amountTarget: numeric("amount_target", {
      precision: 12,
      scale: 2,
    }).notNull(),
    currency: char("currency", { length: 3 }).default("BRL"),
    period: text("period").default("mensal"),
    notes: text("notes"),
  },
  (t) => [unique().on(t.userId, t.seniority, t.regime)]
)

export const standardAnswers = pgTable(
  "standard_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    key: text("key").notNull(),
    questionExamples: text("question_examples").array().default([]),
    answer: text("answer"),
    answerEnc: bytea("answer_enc"),
    language: text("language").default("pt-BR"),
    isSensitive: boolean("is_sensitive").default(false),
    embedding: embedding(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.userId, t.key, t.language)]
)

export const companyBlocklist = pgTable(
  "company_blocklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    companyName: text("company_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    aliases: text("aliases").array().default([]),
    domains: text("domains").array().default([]),
    reason: text("reason"),
  },
  (t) => [index("company_blocklist_user_id_idx").on(t.userId)]
)

// ---------------------------------------------------------------------------
// Jobs (global, public data) and per-user analysis
// ---------------------------------------------------------------------------

export const jobPostings = pgTable("job_postings", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalUrl: text("canonical_url").unique().notNull(),
  source: jobSource("source").notNull(),
  externalId: text("external_id"),
  company: text("company"),
  companyNormalized: text("company_normalized"),
  companyDomain: text("company_domain"),
  title: text("title").notNull(),
  seniority: seniority("seniority"),
  location: text("location"),
  workModel: workModel("work_model"),
  regime: contractRegime("regime").default("nao_informado"),
  language: text("language"),
  requirementsRequired: text("requirements_required").array().default([]),
  requirementsPreferred: text("requirements_preferred").array().default([]),
  languagesRequired: jsonb("languages_required").default([]),
  salaryMin: numeric("salary_min"),
  salaryMax: numeric("salary_max"),
  salaryCurrency: char("salary_currency", { length: 3 }),
  applyUrl: text("apply_url"),
  applyEmail: text("apply_email"),
  descriptionMd: text("description_md"),
  rawHash: text("raw_hash"),
  postedAt: date("posted_at"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  embedding: embedding(),
})

export const jobMatches = pgTable(
  "job_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    jobPostingId: uuid("job_posting_id")
      .notNull()
      .references(() => jobPostings.id),
    fit: fitLevel("fit"),
    fitScore: integer("fit_score"),
    reasons: jsonb("reasons").default([]),
    gaps: jsonb("gaps").default([]),
    alerts: jsonb("alerts").default([]),
    recommendedCvVersionId: uuid("recommended_cv_version_id").references(
      () => cvVersions.id
    ),
    suggestedSalary: jsonb("suggested_salary"),
    duplicateCheck: jsonb("duplicate_check"),
    blocked: boolean("blocked").default(false),
    decision: text("decision"),
    decisionReason: text("decision_reason"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.jobPostingId)]
)

// ---------------------------------------------------------------------------
// Applications and dependants
// ---------------------------------------------------------------------------

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    jobMatchId: uuid("job_match_id").references(() => jobMatches.id),
    jobPostingId: uuid("job_posting_id").references(() => jobPostings.id),
    company: text("company").notNull(),
    roleTitle: text("role_title").notNull(),
    source: jobSource("source").notNull(),
    route: applicationRoute("route"),
    status: applicationStatus("status").notNull().default("rascunho"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    cvVersionId: uuid("cv_version_id").references(() => cvVersions.id),
    cvSha256: text("cv_sha256"),
    salaryInformed: jsonb("salary_informed"),
    nextAction: text("next_action"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    link: text("link"),
    notes: text("notes"),
    externalProtocol: text("external_protocol"),
    lastEmailAt: timestamp("last_email_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("applications_user_status_idx").on(t.userId, t.status),
    index("applications_user_next_action_idx").on(t.userId, t.nextActionDueAt),
  ]
)

export const evidences = pgTable("evidences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id").references(() => applications.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull(),
  storagePath: text("storage_path"),
  textExcerpt: text("text_excerpt"),
  url: text("url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
})

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    fromAddress: text("from_address"),
    fromDomain: text("from_domain"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    snippet: text("snippet"),
    classification: emailClass("classification"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    extracted: jsonb("extracted"),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    reviewStatus: text("review_status").default("auto"),
  },
  (t) => [unique().on(t.userId, t.gmailMessageId)]
)

export const applicationEvents = pgTable("application_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  fromStatus: applicationStatus("from_status"),
  toStatus: applicationStatus("to_status"),
  source: eventSource("source").notNull(),
  confidence: numeric("confidence", { precision: 3, scale: 2 }),
  payload: jsonb("payload").default({}),
  emailThreadId: uuid("email_thread_id").references(() => emailThreads.id),
  evidenceId: uuid("evidence_id").references(() => evidences.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const applicationPackages = pgTable("application_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  payloadEnc: bytea("payload_enc").notNull(),
  cvVersionId: uuid("cv_version_id").references(() => cvVersions.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
})

export const pendingQuestions = pgTable("pending_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id").references(() => applications.id, {
    onDelete: "cascade",
  }),
  questionText: text("question_text").notNull(),
  fieldType: text("field_type"),
  options: jsonb("options"),
  proposedAnswer: text("proposed_answer"),
  proposedFrom: jsonb("proposed_from"),
  answer: text("answer"),
  remember: boolean("remember").default(false),
  status: text("status").default("aberta"),
  createdAt: createdAt(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
})

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  kind: approvalKind("kind").notNull(),
  applicationId: uuid("application_id").references(() => applications.id, {
    onDelete: "cascade",
  }),
  subjectRef: jsonb("subject_ref").notNull(),
  preview: jsonb("preview").notNull(),
  previewSha256: text("preview_sha256").notNull(),
  status: approvalStatus("status").notNull().default("pendente"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedVia: text("decided_via"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: jsonb("scope"),
  createdAt: createdAt(),
})

export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id").references(() => applications.id, {
    onDelete: "cascade",
  }),
  toAddresses: text("to_addresses").array().notNull(),
  ccAddresses: text("cc_addresses").array().default([]),
  subject: text("subject").notNull(),
  bodyMd: text("body_md").notNull(),
  attachmentCvVersionId: uuid("attachment_cv_version_id").references(
    () => cvVersions.id
  ),
  status: text("status").default("rascunho"),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
})

// ---------------------------------------------------------------------------
// Gmail, chat, audit, consents, devices, billing
// ---------------------------------------------------------------------------

export const gmailConnections = pgTable("gmail_connections", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  googleEmail: text("google_email").notNull(),
  scopes: text("scopes").array().notNull(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  lastHistoryId: text("last_history_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  status: text("status").default("ativo"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow(),
  lastError: text("last_error"),
  syncLockUntil: timestamp("sync_lock_until", { withTimezone: true }),
})

/** In-app bell and deadline reminders (P4.3, RF11.6). Text is rendered from `kind` + `params`. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    kind: text("kind").notNull(),
    params: jsonb("params").notNull().default({}),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    emailThreadId: uuid("email_thread_id").references(() => emailThreads.id, {
      onDelete: "cascade",
    }),
    dedupeKey: text("dedupe_key"),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.userId, t.dedupeKey)]
)

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  title: text("title"),
  createdAt: createdAt(),
})

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  parts: jsonb("parts").notNull(),
  createdAt: createdAt(),
})

/** Append-only (update/delete revoked in SQL). No FK to auth.users: entries outlive the account. */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  approvalId: uuid("approval_id"),
  details: jsonb("details"),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
})

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  purpose: text("purpose").notNull(),
  version: text("version").notNull(),
  granted: boolean("granted").notNull(),
  createdAt: createdAt(),
})

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  name: text("name"),
  tokenHash: text("token_hash").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})

export const devicePairingCodes = pgTable("device_pairing_codes", {
  code: text("code").primaryKey(),
  userId: ownerId(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  createdAt: createdAt(),
})

/** Public pairing endpoint counters. No client access (service role only). */
export const pairingIpAttempts = pgTable("pairing_ip_attempts", {
  ip: text("ip").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
})

export const pairingCodeAttempts = pgTable("pairing_code_attempts", {
  code: text("code").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
})

export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
})

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: uuid("user_id"),
    period: char("period", { length: 7 }),
    metric: text("metric"),
    value: integer("value").default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period, t.metric] })]
)

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
})

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  scheduledPurgeAt: timestamp("scheduled_purge_at", {
    withTimezone: true,
  }).notNull(),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
})

export const privacyExports = pgTable("privacy_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  storagePath: text("storage_path"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
})

/** Wrapped per-user DEKs (12.3). Server only; deleting a row is crypto-shredding. */
export const userKeys = pgTable("user_keys", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  wrappedDek: bytea("wrapped_dek").notNull(),
  keyId: text("key_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// ---------------------------------------------------------------------------
// P2: job ingestion progress, saved searches and F14 settings
// ---------------------------------------------------------------------------

const createdAtNotNull = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAtNotNull = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

/** RF4A.3 saved search: the same record whether created by chat or by form (CA14.7). */
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    query: text("query").notNull(),
    seniority: seniority("seniority"),
    location: text("location"),
    radiusKm: integer("radius_km"),
    workModel: workModel("work_model"),
    regime: contractRegime("regime"),
    language: text("language"),
    salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
    salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
    postedWithinDays: integer("posted_within_days"),
    excludedCompanies: text("excluded_companies").array().notNull().default([]),
    frequency: text("frequency").notNull().default("diaria"),
    timeOfDay: text("time_of_day"),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAtNotNull(),
    updatedAt: updatedAtNotNull(),
  },
  (t) => [index("saved_searches_user_id_idx").on(t.userId, t.createdAt)]
)

/** One row per link (or pasted text) of a batch; progress is published via Realtime (8.4). */
export const jobIngestions = pgTable(
  "job_ingestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    batchId: uuid("batch_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    savedSearchId: uuid("saved_search_id").references(() => savedSearches.id, {
      onDelete: "cascade",
    }),
    inputUrl: text("input_url"),
    inputText: text("input_text"),
    canonicalUrl: text("canonical_url"),
    source: jobSource("source"),
    status: text("status").notNull().default("pendente"),
    errorCode: text("error_code"),
    jobPostingId: uuid("job_posting_id").references(() => jobPostings.id),
    jobMatchId: uuid("job_match_id").references(() => jobMatches.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtNotNull(),
    updatedAt: updatedAtNotNull(),
  },
  (t) => [index("job_ingestions_user_batch_idx").on(t.userId, t.batchId)]
)

/** Global exclusions on top of `company_blocklist` (F14 add_excluded_company). */
export const excludedCompanies = pgTable(
  "excluded_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    companyName: text("company_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: createdAtNotNull(),
  },
  (t) => [unique().on(t.userId, t.normalizedName)]
)

/** set_preference: enum keys (packages/core/settings.ts). */
export const preferences = pgTable(
  "preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: updatedAtNotNull(),
  },
  (t) => [unique().on(t.userId, t.key)]
)

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  approvalMode: text("approval_mode").notNull().default("pausar_antes"),
  updatedAt: updatedAtNotNull(),
})

/** Memory (RF14.5): `before` is the exact previous state restored by undo (CA14.2). */
export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerId(),
    intent: text("intent").notNull(),
    origin: text("origin").notNull(),
    utterance: text("utterance"),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    status: text("status").notNull().default("aplicada"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtNotNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("memory_events_user_created_idx").on(t.userId, t.createdAt)]
)

// Cloud browser pool (migration 20261023190000). Secrets are never stored: only env var names.
export const appAdmins = pgTable("app_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt: createdAt(),
})

export const browserProviders = pgTable("browser_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  accountEmail: text("account_email"),
  secretEnvVar: text("secret_env_var").notNull(),
  projectEnvVar: text("project_env_var"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
  maxSessionSeconds: integer("max_session_seconds"),
  quotaKind: text("quota_kind").notNull(),
  quotaUnit: text("quota_unit").notNull().default("units"),
  quotaLimit: numeric("quota_limit").notNull(),
  costPerMinute: numeric("cost_per_minute").notNull().default("0"),
  quotaResetDay: integer("quota_reset_day"),
  quotaStartedAt: timestamp("quota_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  keyExpiresAt: timestamp("key_expires_at", { withTimezone: true }),
  alertThreshold: numeric("alert_threshold").notNull().default("0.8"),
  notes: text("notes"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestMessage: text("last_test_message"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const applyRuns = pgTable("apply_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: ownerId(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  jobMatchId: uuid("job_match_id").references(() => jobMatches.id, {
    onDelete: "set null",
  }),
  packageId: uuid("package_id").references(() => applicationPackages.id, {
    onDelete: "set null",
  }),
  ats: text("ats").notNull(),
  targetUrl: text("target_url").notNull(),
  phase: text("phase").notNull().default("queued"),
  stepIndex: integer("step_index").notNull().default(0),
  segments: integer("segments").notNull().default(0),
  stateEnc: bytea("state_enc"),
  reviewSummary: jsonb("review_summary"),
  reviewScreenshotEnc: bytea("review_screenshot_enc"),
  approvalId: uuid("approval_id").references(() => approvals.id, {
    onDelete: "set null",
  }),
  providerId: uuid("provider_id").references(() => browserProviders.id, {
    onDelete: "set null",
  }),
  liveViewUrl: text("live_view_url"),
  lastError: text("last_error"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
})

export const browserSessions = pgTable("browser_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id").references(() => browserProviders.id, {
    onDelete: "set null",
  }),
  provider: text("provider").notNull(),
  userId: uuid("user_id").references(() => authUsers.id, {
    onDelete: "cascade",
  }),
  applyRunId: uuid("apply_run_id").references(() => applyRuns.id, {
    onDelete: "set null",
  }),
  externalId: text("external_id"),
  status: text("status").notNull().default("ativa"),
  purpose: text("purpose").notNull().default("apply"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  unitsUsed: numeric("units_used").notNull().default("0"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
})

export const browserAuthStates = pgTable(
  "browser_auth_states",
  {
    userId: ownerId(),
    site: text("site").notNull(),
    storageEnc: bytea("storage_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.site] })]
)
