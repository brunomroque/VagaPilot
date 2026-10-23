/**
 * Chat attachments (CVs, job screenshots, job descriptions): limits, content-type detection
 * and intent inference. Pure: no I/O.
 */

export const MAX_ATTACHMENTS_PER_MESSAGE = 4
/** Netlify functions accept ~6 MB request bodies; keep each file well under it. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENT_TEXT_CHARS = 20_000

export const ATTACHMENT_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const

export type AttachmentFileType = keyof typeof ATTACHMENT_MIME
export type AttachmentKind = "cv" | "job_description" | "job_image" | "document"

export type AttachmentErrorCode =
  "file_empty" | "file_too_large" | "unsupported_type" | "too_many_files"

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode
  constructor(code: AttachmentErrorCode, message: string) {
    super(message)
    this.name = "AttachmentError"
    this.code = code
  }
}

const MAGIC: [AttachmentFileType, number[]][] = [
  ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ["docx", [0x50, 0x4b, 0x03, 0x04]],
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", [0xff, 0xd8, 0xff]],
]

function startsWith(bytes: Uint8Array, magic: number[], offset = 0) {
  return magic.every((value, index) => bytes[offset + index] === value)
}

/** Type from magic bytes cross-checked with the extension; anything else is refused. */
export function detectAttachmentType(
  bytes: Uint8Array,
  name: string
): AttachmentFileType {
  if (bytes.byteLength === 0)
    throw new AttachmentError("file_empty", "Empty file")
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError("file_too_large", "File is larger than 4 MB")
  }
  const ext = name.toLowerCase().split(".").pop() ?? ""
  const normalizedExt = ext === "jpeg" ? "jpg" : ext
  for (const [type, magic] of MAGIC) {
    if (startsWith(bytes, magic) && normalizedExt === type) return type
  }
  if (
    normalizedExt === "webp" &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp"
  }
  if (normalizedExt === "txt" && looksLikeUtf8Text(bytes)) return "txt"
  throw new AttachmentError(
    "unsupported_type",
    "Only PDF, DOCX, TXT, PNG, JPG and WEBP are accepted"
  )
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096)
  for (const byte of sample) {
    if (byte === 0) return false
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      sample.subarray(0, sample.length - 4)
    )
    return true
  } catch {
    return false
  }
}

export function isImageType(type: AttachmentFileType): boolean {
  return type === "png" || type === "jpg" || type === "webp"
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const CV_SIGNALS = [
  /\bexperiencia profissional\b/,
  /\bprofessional experience\b/,
  /\bwork experience\b/,
  /\bformacao academica\b/,
  /\beducation\b/,
  /\bcertifica(coes|cao|tions?)\b/,
  /\bresumo profissional\b/,
  /\b(professional )?summary\b/,
  /\bcurriculo\b|\bcurriculum\b|\bresume\b/,
  /\blinkedin\.com\/in\//,
  /\b(19|20)\d{2}\s*[-–]\s*((19|20)\d{2}|atual|presente|present|current)\b/,
]

const JD_SIGNALS = [
  /\brequisitos\b|\brequirements\b|\bqualifications\b/,
  /\bresponsabilidades\b|\bresponsibilities\b|\batribuicoes\b/,
  /\bdiferenciais\b|\bnice to have\b|\bpreferred\b/,
  /\bbeneficios\b|\bbenefits\b/,
  /\bsobre a vaga\b|\babout the (role|job)\b|\bdescricao da vaga\b/,
  /\bcandidate-se\b|\bapply\b|\bvaga\b/,
  /\bvoce (ira|vai)\b|\byou will\b|\bwhat you.ll do\b/,
  /\bmodelo de trabalho\b|\bhibrido\b|\bremoto\b|\bremote\b|\bpresencial\b/,
]

/** Rule-based: is this document text a CV, a job description or something else? */
export function classifyDocumentText(
  text: string,
  fileName = ""
): AttachmentKind {
  const folded = fold(`${fileName}\n${text.slice(0, 15_000)}`)
  const name = fold(fileName)
  const cv =
    CV_SIGNALS.filter((re) => re.test(folded)).length +
    (/\b(cv|curriculo|resume|curriculum)\b/.test(name) ? 2 : 0)
  const jd =
    JD_SIGNALS.filter((re) => re.test(folded)).length +
    (/\b(vaga|job|jd|descricao)\b/.test(name) ? 2 : 0)
  if (cv === 0 && jd === 0) return "document"
  if (cv >= jd + 1) return "cv"
  if (jd >= cv + 1) return "job_description"
  return "document"
}

export type AttachmentIntent =
  | "cv_review"
  | "cv_update_profile"
  | "cv_new_version"
  | "cv_vs_job"
  | "job_link"
  | "job_from_image"
  | "job_description"
  | "apply"
  | "ask"

export type AttachmentSummary = {
  kind: AttachmentKind
  /** For job images: link read from the screenshot, if any. */
  url?: string | null
}

export type IntentDecision = {
  intent: AttachmentIntent
  /** Quick replies when `intent` is "ask". Keys of Chat.attachments.options. */
  options: AttachmentOptionKey[]
}

export type AttachmentOptionKey =
  | "review"
  | "updateProfile"
  | "newVersion"
  | "compareJob"
  | "apply"
  | "analyzeJob"
  | "skip"

const INTENT_WORDS: [AttachmentIntent, RegExp][] = [
  ["apply", /\b(candidat\w*|aplica\w*|apply|inscrev\w*)\b/],
  ["cv_vs_job", /\b(compar\w*|match|ader\w*|fit|ats|score|nota)\b/],
  ["cv_new_version", /\b(nova versao|salv\w*|guard\w*|new version|save)\b/],
  [
    "cv_update_profile",
    /\b(atualiz\w* (meus )?dados|atualiz\w* (o )?perfil|update (my )?(profile|data)|import\w*)\b/,
  ],
  [
    "cv_review",
    /\b(revis\w*|review|analis\w*|melhor\w*|feedback|corrig\w*|avali\w*)\b/,
  ],
]

/** Infers what the user wants from the attachments plus the message; asks when ambiguous. */
export function detectAttachmentIntent(
  attachments: AttachmentSummary[],
  message: string
): IntentDecision {
  const text = fold(message)
  const has = (kind: AttachmentKind) => attachments.some((a) => a.kind === kind)
  const hasCv = has("cv")
  const hasJob =
    has("job_description") || has("job_image") || /https?:\/\//.test(text)
  const words = INTENT_WORDS.filter(([, re]) => re.test(text)).map(([i]) => i)

  if (hasCv && hasJob) {
    if (words.includes("apply")) return { intent: "apply", options: [] }
    return { intent: "cv_vs_job", options: [] }
  }
  if (hasJob) {
    const image = attachments.find((a) => a.kind === "job_image")
    if (words.includes("apply")) return { intent: "apply", options: [] }
    if (image && !has("job_description")) {
      return { intent: image.url ? "job_link" : "job_from_image", options: [] }
    }
    return { intent: "job_description", options: [] }
  }
  if (hasCv) {
    const cvIntents = words.filter((w) =>
      [
        "cv_review",
        "cv_update_profile",
        "cv_new_version",
        "cv_vs_job",
      ].includes(w)
    )
    if (cvIntents.length === 1) {
      return { intent: cvIntents[0]!, options: [] }
    }
    return {
      intent: "ask",
      options: ["review", "updateProfile", "newVersion", "compareJob"],
    }
  }
  return { intent: "ask", options: ["review", "analyzeJob", "skip"] }
}
