import { extractUrls } from "./guardrails.js"

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/** User-facing quick-reply actions for attachment turns (chat composer). */
export const ATTACHMENT_INTENT_IDS = [
  "review_cv",
  "update_profile_from_cv",
  "save_cv_version",
  "analyze_job",
  "compare_cv_job",
  "start_apply",
] as const

export type AttachmentIntentId = (typeof ATTACHMENT_INTENT_IDS)[number]

export type StoredAttachmentKind = "cv" | "job_image" | "job_document"

export type AttachmentIntentOption = {
  id: AttachmentIntentId
  /** i18n key under Chat.attach.intents */
  labelKey: string
}

export type AttachmentIntentResult =
  | {
      mode: "explicit"
      intent: AttachmentIntentId
    }
  | {
      mode: "clarify"
      questionKey: string
      options: AttachmentIntentOption[]
    }
  | {
      mode: "auto"
      intent: AttachmentIntentId
    }

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"])
const DOC_EXT = new Set(["pdf", "docx", "txt"])

export function attachmentExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop()?.trim() ?? ""
}

/** MIME + extension check for uploads (no magic bytes here — server validates bytes). */
export function detectStoredAttachmentKind(
  fileName: string,
  role: "auto" | StoredAttachmentKind
): StoredAttachmentKind | "ambiguous_document" | "unsupported" {
  const ext = attachmentExtension(fileName)
  if (IMAGE_EXT.has(ext)) return "job_image"
  if (ext === "txt") return "job_document"
  if (ext === "pdf" || ext === "docx") {
    if (role === "auto") return "ambiguous_document"
    return role
  }
  return "unsupported"
}

export type ResolvedAttachmentBundle = {
  hasCv: boolean
  hasJobImage: boolean
  hasJobDocument: boolean
  hasUrl: boolean
  ambiguousDocument: boolean
}

export function resolveAttachmentBundle(
  kinds: StoredAttachmentKind[],
  messageText: string
): ResolvedAttachmentBundle {
  const hasUrl = extractUrls(messageText).length > 0
  const hasJobImage = kinds.includes("job_image")
  let hasCv = kinds.includes("cv")
  let hasJobDocument = kinds.includes("job_document") || hasJobImage || hasUrl
  const folded = fold(messageText)

  if (/\b(cv|curriculo|curriculum|resume)\b/.test(folded)) hasCv = true
  if (
    /\b(vaga|vagas|job|descricao da vaga|requisitos|jd|anuncio)\b/.test(folded)
  ) {
    hasJobDocument = true
  }

  return {
    hasCv,
    hasJobImage,
    hasJobDocument,
    hasUrl,
    ambiguousDocument: false,
  }
}

function intentFromMessage(folded: string): AttachmentIntentId | null {
  if (/\b(candidat|aplicar|aplica)\b/.test(folded)) return "start_apply"
  if (/\b(comparar|comparacao|fit|aderencia|ats)\b/.test(folded))
    return "compare_cv_job"
  if (/\b(analis|avali|vale a pena)\b.*\b(vaga|job)\b/.test(folded))
    return "analyze_job"
  if (
    /\b(atualiz|importar|sincroniz)\b.*\b(perfil|dados|sistema)\b/.test(folded)
  )
    return "update_profile_from_cv"
  if (/\b(salvar|nova versao|guardar)\b.*\b(cv|curriculo)\b/.test(folded))
    return "save_cv_version"
  if (/\b(revis|revisar|revise|melhorar|otimizar)\b/.test(folded))
    return "review_cv"
  return null
}

function defaultOptions(
  bundle: ResolvedAttachmentBundle
): AttachmentIntentOption[] {
  if (bundle.hasCv && bundle.hasJobDocument) {
    return [
      { id: "compare_cv_job", labelKey: "compare_cv_job" },
      { id: "start_apply", labelKey: "start_apply" },
      { id: "review_cv", labelKey: "review_cv" },
      { id: "analyze_job", labelKey: "analyze_job" },
    ]
  }
  if (bundle.hasCv) {
    return [
      { id: "review_cv", labelKey: "review_cv" },
      { id: "update_profile_from_cv", labelKey: "update_profile_from_cv" },
      { id: "save_cv_version", labelKey: "save_cv_version" },
    ]
  }
  if (bundle.hasJobDocument || bundle.hasJobImage || bundle.hasUrl) {
    return [
      { id: "analyze_job", labelKey: "analyze_job" },
      { id: "start_apply", labelKey: "start_apply" },
    ]
  }
  return [{ id: "analyze_job", labelKey: "analyze_job" }]
}

/**
 * Infer what the user wants from message text + attachment kinds. When unclear, returns quick-reply options.
 */
export function classifyAttachmentIntent(
  messageText: string,
  kinds: StoredAttachmentKind[]
): AttachmentIntentResult {
  const bundle = resolveAttachmentBundle(kinds, messageText)
  const folded = fold(messageText)
  const explicit = intentFromMessage(folded)

  if (explicit) {
    if (
      explicit === "start_apply" &&
      !bundle.hasJobDocument &&
      !bundle.hasUrl
    ) {
      return {
        mode: "clarify",
        questionKey: "missing_job",
        options: defaultOptions(bundle),
      }
    }
    if (
      explicit === "compare_cv_job" &&
      !bundle.hasCv &&
      !bundle.hasJobDocument
    ) {
      return {
        mode: "clarify",
        questionKey: "missing_pair",
        options: defaultOptions(bundle),
      }
    }
    return { mode: "explicit", intent: explicit }
  }

  if (bundle.hasJobImage && !bundle.hasCv && !messageText.trim()) {
    return { mode: "auto", intent: "analyze_job" }
  }

  if (bundle.hasUrl && !bundle.hasCv && messageText.trim().length < 40) {
    return { mode: "auto", intent: "analyze_job" }
  }

  if (
    bundle.hasCv &&
    !bundle.hasJobDocument &&
    !bundle.hasUrl &&
    !messageText.trim()
  ) {
    return {
      mode: "clarify",
      questionKey: "cv_only",
      options: defaultOptions(bundle),
    }
  }

  if (bundle.hasCv && bundle.hasJobDocument) {
    return {
      mode: "clarify",
      questionKey: "cv_and_job",
      options: defaultOptions(bundle),
    }
  }

  if (bundle.hasJobDocument || bundle.hasJobImage) {
    return { mode: "auto", intent: "analyze_job" }
  }

  return {
    mode: "clarify",
    questionKey: "generic",
    options: defaultOptions(bundle),
  }
}

export function isAttachmentIntentId(
  value: string
): value is AttachmentIntentId {
  return (ATTACHMENT_INTENT_IDS as readonly string[]).includes(value)
}

/** When PDF/DOCX role is unknown, infer from the composer message (defaults to CV). */
export function resolveDocumentRole(messageHint: string): StoredAttachmentKind {
  const folded = fold(messageHint)
  if (
    /\b(vaga|vagas|job|descricao|requisitos|jd|anuncio|linkedin)\b/.test(
      folded
    ) &&
    !/\b(cv|curriculo|curriculum|resume)\b/.test(folded)
  ) {
    return "job_document"
  }
  return "cv"
}
