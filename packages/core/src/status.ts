/**
 * Application status machine (spec 9.4, F10 RF10.1). Pure: no I/O.
 * Values mirror the Postgres enums `application_status` and `event_source` (spec 9.2).
 */

export const APPLICATION_STATUSES = [
  "rascunho",
  "descartada",
  "em_andamento",
  "enviada",
  "em_analise",
  "etapa_pendente",
  "entrevista",
  "proposta",
  "reprovada",
  "encerrada",
] as const

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const EVENT_SOURCES = [
  "usuario",
  "agente",
  "extensao",
  "gmail",
  "worker",
  "sistema",
] as const

export type EventSource = (typeof EVENT_SOURCES)[number]

/** Confidence an automatic update needs to apply without review (spec 9.4: ≥ 0,8). */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.8

const STATUS_SET: ReadonlySet<string> = new Set(APPLICATION_STATUSES)
const SOURCE_SET: ReadonlySet<string> = new Set(EVENT_SOURCES)

export function isApplicationStatus(
  value: unknown
): value is ApplicationStatus {
  return typeof value === "string" && STATUS_SET.has(value)
}

export function isEventSource(value: unknown): value is EventSource {
  return typeof value === "string" && SOURCE_SET.has(value)
}

/** Transitions listed in spec 9.4. Self edge `entrevista → entrevista` is a new interview round. */
const BASE_TRANSITIONS = {
  rascunho: ["em_andamento", "descartada", "enviada"],
  em_andamento: ["enviada", "descartada", "rascunho"],
  enviada: [
    "em_analise",
    "etapa_pendente",
    "entrevista",
    "reprovada",
    "encerrada",
  ],
  em_analise: ["etapa_pendente", "entrevista", "reprovada", "encerrada"],
  etapa_pendente: ["em_analise", "entrevista", "reprovada", "encerrada"],
  entrevista: [
    "etapa_pendente",
    "entrevista",
    "proposta",
    "reprovada",
    "encerrada",
  ],
  proposta: ["encerrada"],
  reprovada: [],
  encerrada: [],
  descartada: [],
} as const satisfies Record<ApplicationStatus, readonly ApplicationStatus[]>

/**
 * Manual-only reopening of terminal states ("reprovada é terminal; reabrir só manualmente").
 * The spec lists no targets; these keep the process where it can continue.
 */
const MANUAL_REOPEN = {
  reprovada: ["enviada", "em_analise", "etapa_pendente", "entrevista"],
  encerrada: ["enviada", "em_analise", "etapa_pendente", "entrevista"],
  descartada: ["rascunho"],
} as const satisfies Partial<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
>

export const TERMINAL_STATUSES = [
  "reprovada",
  "encerrada",
  "descartada",
] as const

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

export function isTerminalStatus(
  status: ApplicationStatus
): status is TerminalStatus {
  switch (status) {
    case "reprovada":
    case "encerrada":
    case "descartada":
      return true
    case "rascunho":
    case "em_andamento":
    case "enviada":
    case "em_analise":
    case "etapa_pendente":
    case "entrevista":
    case "proposta":
      return false
    default: {
      const unreachable: never = status
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}

/**
 * Progress order used to detect regressions in automatic updates. Terminal outcomes rank last:
 * moving into them is never a regression; leaving them is blocked separately.
 */
export function statusRank(status: ApplicationStatus): number {
  switch (status) {
    case "rascunho":
      return 0
    case "em_andamento":
      return 1
    case "enviada":
      return 2
    case "em_analise":
      return 3
    case "etapa_pendente":
      return 4
    case "entrevista":
      return 5
    case "proposta":
      return 6
    case "reprovada":
    case "encerrada":
    case "descartada":
      return 7
    default: {
      const unreachable: never = status
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}

/** Only the user's own action is manual. Agent, extension, Gmail, worker and system are automatic. */
export function isAutomaticSource(source: EventSource): boolean {
  switch (source) {
    case "usuario":
      return false
    case "agente":
    case "extensao":
    case "gmail":
    case "worker":
    case "sistema":
      return true
    default: {
      const unreachable: never = source
      throw new Error(`Unknown source: ${String(unreachable)}`)
    }
  }
}

export interface TransitionContext {
  source: EventSource
  /**
   * True when a person explicitly confirmed this change (e.g. a click on a chat card or in the
   * "Revise" queue). The event keeps its real source but manual rules apply.
   */
  confirmedByUser?: boolean
  /** Classifier confidence (0–1). Required for automatic updates. */
  confidence?: number | null
  /** Automatic updates must carry proof: an e-mail thread or an evidence id (CA10.2). */
  hasEvidence?: boolean
}

export type TransitionRejection =
  | "same_status"
  | "not_allowed"
  | "terminal_requires_user"
  | "regression"
  | "missing_evidence"
  | "needs_review"

export type TransitionMode = "manual" | "automatic"

export type TransitionResult =
  | { ok: true; mode: TransitionMode; reopen: boolean }
  | { ok: false; mode: TransitionMode; reason: TransitionRejection }

function includesStatus(
  list: readonly ApplicationStatus[],
  status: ApplicationStatus
): boolean {
  return list.includes(status)
}

function reopenTargets(from: ApplicationStatus): readonly ApplicationStatus[] {
  switch (from) {
    case "reprovada":
    case "encerrada":
    case "descartada":
      return MANUAL_REOPEN[from]
    case "rascunho":
    case "em_andamento":
    case "enviada":
    case "em_analise":
    case "etapa_pendente":
    case "entrevista":
    case "proposta":
      return []
    default: {
      const unreachable: never = from
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}

export function transitionMode(context: TransitionContext): TransitionMode {
  return isAutomaticSource(context.source) && !context.confirmedByUser
    ? "automatic"
    : "manual"
}

/** Validates one status change. Never throws for valid enum input. */
export function checkTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  context: TransitionContext
): TransitionResult {
  const mode = transitionMode(context)
  const base: readonly ApplicationStatus[] = BASE_TRANSITIONS[from]
  const inBase = includesStatus(base, to)

  if (from === to && !inBase) return { ok: false, mode, reason: "same_status" }

  if (mode === "manual") {
    if (inBase) return { ok: true, mode, reopen: false }
    if (includesStatus(reopenTargets(from), to)) {
      return { ok: true, mode, reopen: true }
    }
    return { ok: false, mode, reason: "not_allowed" }
  }

  if (isTerminalStatus(from)) {
    return { ok: false, mode, reason: "terminal_requires_user" }
  }
  if (!inBase) return { ok: false, mode, reason: "not_allowed" }
  if (statusRank(to) < statusRank(from)) {
    return { ok: false, mode, reason: "regression" }
  }
  if (!context.hasEvidence)
    return { ok: false, mode, reason: "missing_evidence" }
  if (
    typeof context.confidence !== "number" ||
    Number.isNaN(context.confidence) ||
    context.confidence < AUTO_APPLY_MIN_CONFIDENCE
  ) {
    return { ok: false, mode, reason: "needs_review" }
  }
  return { ok: true, mode, reopen: false }
}

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  context: TransitionContext
): boolean {
  return checkTransition(from, to, context).ok
}

/** Every status reachable from `from` under `context`, in enum order. */
export function allowedTransitions(
  from: ApplicationStatus,
  context: TransitionContext
): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter((to) => canTransition(from, to, context))
}

/** Statuses that count as "the company answered" for the response rate (J6). */
export function isResponseStatus(status: ApplicationStatus): boolean {
  switch (status) {
    case "em_analise":
    case "etapa_pendente":
    case "entrevista":
    case "proposta":
    case "reprovada":
      return true
    case "rascunho":
    case "descartada":
    case "em_andamento":
    case "enviada":
    case "encerrada":
      return false
    default: {
      const unreachable: never = status
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}

/** Statuses that mean the application left the user's hands (sent or later). */
export function isSubmittedStatus(status: ApplicationStatus): boolean {
  switch (status) {
    case "enviada":
    case "em_analise":
    case "etapa_pendente":
    case "entrevista":
    case "proposta":
    case "reprovada":
    case "encerrada":
      return true
    case "rascunho":
    case "descartada":
    case "em_andamento":
      return false
    default: {
      const unreachable: never = status
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}
