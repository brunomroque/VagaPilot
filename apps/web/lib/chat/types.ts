/**
 * Shapes shared by the chat route, the server actions and the widgets. Client-safe (no I/O).
 * Tool outputs carry a `kind` so the UI picks the widget; `summary` is the sentence the
 * assistant says about the result.
 */

export type FitLevel = "alto" | "medio" | "baixo"
export type JobDecision = "aplicar" | "pular" | "salvar"
export type IngestionStatus =
  "pendente" | "processando" | "concluida" | "falhou" | "bloqueada"

export type AlertView = {
  code: string
  message: string
  params?: Record<string, string | number>
}

export type JobCardData = {
  matchId: string
  postingId: string
  company: string | null
  title: string
  location: string | null
  workModel: string | null
  regime: string | null
  seniority: string | null
  source: string
  canonicalUrl: string
  applyUrl: string | null
  applyEmail: string | null
  description: string | null
  requirementsRequired: string[]
  requirementsPreferred: string[]
  fit: FitLevel | null
  score: number | null
  reasons: { text: string; factIds: string[]; requirement?: string }[]
  gaps: {
    requirement: string
    severity: "obrigatorio" | "desejavel"
    note?: string
  }[]
  alerts: AlertView[]
  blocked: boolean
  duplicate: {
    status: "nao_aplicado" | "ja_aplicado" | "possivel_duplicata"
    appliedAt?: string | null
    applicationId?: string
    reason?: string
    gmail?: {
      searchStatus: "not_connected" | "ok" | "partial"
      matchCount: number
      latestSubject?: string
      latestReceivedAt?: string
    }
  } | null
  cv: { id: string; label: string; language: string } | null
  salary: {
    status: "rule" | "no_rule" | "no_seniority"
    target: number | null
    min: number | null
    currency: string
    period: string
    regime: string | null
    jobMin: number | null
    jobMax: number | null
    override: number | null
  }
  decision: JobDecision | null
  application: { id: string; status: string } | null
  modelVersion: string | null
  promptVersion: string | null
}

export type IngestItem = {
  ingestionId: string
  url: string | null
  status: IngestionStatus
  errorCode: string | null
  jobMatchId: string | null
}

export type DiffRow = { field: string; before: unknown; after: unknown }

export type SettingsChangeOutput =
  | {
      kind: "settings_change"
      status: "applied" | "pending" | "undone" | "cancelled"
      intent: string
      memoryEventId: string
      diff: DiffRow[]
      summary: string
    }
  | {
      kind: "settings_change"
      status: "noop" | "error"
      intent: string
      code?: string
      summary: string
    }
  | {
      kind: "settings_change"
      status: "clarification"
      intent: string
      question: string
      options: string[]
      summary: string
    }

export type ChatToolOutput =
  | {
      kind: "ingest_batch"
      batchId: string
      items: IngestItem[]
      summary: string
    }
  | {
      kind: "job_card"
      jobMatchId: string
      summary: string
      fit: FitLevel | null
      reasons: string[]
      gaps: string[]
      alerts: string[]
    }
  | {
      kind: "duplicate"
      status: string
      appliedAt: string | null
      summary: string
    }
  | {
      kind: "facts"
      facts: { id: string; statement: string }[]
      summary: string
    }
  | { kind: "profile"; summary: string; profile: unknown }
  | {
      kind: "cv"
      cvVersionId: string | null
      label: string | null
      language: string
      summary: string
    }
  | {
      kind: "salary"
      status: string
      target: number | null
      currency: string
      summary: string
    }
  | {
      kind: "status_change"
      applicationId: string
      company: string
      roleTitle: string
      from: string | null
      to: string
      summary: string
    }
  | {
      kind: "action_list"
      actions: {
        applicationId: string
        company: string
        roleTitle: string
        action: string
        dueAt: string | null
      }[]
      counts: { sentThisWeek: number; active: number; pending: number }
      summary: string
    }
  | { kind: "settings"; summary: string; snapshot: unknown }
  | {
      kind: "clarification"
      question: string
      options: string[]
      summary: string
    }
  | {
      kind: "fact_approval"
      approvalId: string
      factId: string
      statement: string
      summary: string
    }
  | {
      kind: "email_draft"
      draftId: string
      subject: string
      bodyMd: string
      to: string[]
      summary: string
    }
  | {
      kind: "email_approval"
      approvalId: string
      draftId: string
      preview: { subject: string; to: string[]; excerpt: string }
      summary: string
    }
  | { kind: "email_sent"; approvalId: string; summary: string }
  | {
      kind: "export_link"
      format: "csv" | "pdf"
      path: string
      summary: string
    }
  | { kind: "error"; code: string; summary: string }
  | {
      kind: "next_steps"
      items: {
        id: string
        title: string
        description?: string
        href?: string
        prompt?: string
      }[]
      summary: string
    }
  | {
      kind: "deep_link"
      href: string
      label: string
      summary: string
    }
  | {
      kind: "options"
      question: string
      options: string[]
      allowFreeText?: boolean
      summary: string
    }
  | {
      kind: "ats_score"
      jobMatchId: string
      before: number
      after: number | null
      covered: string[]
      missing: string[]
      summary: string
    }
  | {
      kind: "cv_diff"
      approvalId: string
      trackLabel: string
      additions: string[]
      beforeScore: number
      afterScore: number
      summary: string
    }
  | {
      kind: "fact_classification"
      approvalId?: string
      factId?: string
      pendingQuestionId?: string
      statement: string
      suggestedUsage: "cv_relevant" | "form_only"
      destinations: (
        "application_only" | "save_fact" | "update_cvs" | "register_gap"
      )[]
      summary: string
    }
  | {
      kind: "application_card"
      applicationId: string
      company: string
      roleTitle: string
      status: string
      summary: string
    }
  | {
      kind: "profile_tracking"
      platforms: {
        id: string
        platform: string
        outdated: boolean
        outdatedReason: string | null
        url: string | null
      }[]
      summary: string
    }
  | {
      kind: "apply_run"
      jobMatchId: string
      runId: string | null
      company: string
      roleTitle: string
      available: boolean
      unavailableReason: string | null
      summary: string
    }
  | {
      kind: "file_upload"
      attachmentId: string
      fileName: string
      mimeType: string
      cvVersionId?: string
      summary: string
    }
  | {
      kind: "attachment_progress"
      cvVersionId: string
      status: "processando" | "pronto" | "falhou"
      proposedFacts?: number
      summary: string
    }
  | {
      kind: "cv_review"
      cvVersionId: string
      lines: string[]
      proposedFacts: number
      summary: string
    }
  | {
      kind: "attachment_intent"
      attachmentIds: string[]
      question: string
      options: { id: string; label: string }[]
      summary: string
    }
  | SettingsChangeOutput
