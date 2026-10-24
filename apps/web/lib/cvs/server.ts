import "server-only"

import type { FactStatus } from "@vagapilot/core/facts"
import { visibleFactIds } from "@/lib/facts/server"

import { randomUUID } from "node:crypto"

import {
  buildCvFilename,
  isCvLanguage,
  type CvLanguage,
} from "@vagapilot/core/cv-filename"
import { SupabaseAuditSink } from "@vagapilot/db/server"
import {
  CV_MIME_TYPES,
  CvFileError,
  cvUploadedEvent,
  detectCvFileType,
  inngest,
  isInngestConfigured,
  processCvUpload,
  sha256Hex,
  type CvFileErrorCode,
  type CvProfileDiffItem,
} from "@vagapilot/jobs"

import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export const SIGNED_URL_TTL_SECONDS = 5 * 60

export type CvTrackRow = {
  id: string
  name: string
  description: string | null
  keywords: string[] | null
}

export type CvVersionRow = {
  id: string
  track_id: string | null
  language: string
  label: string
  is_default: boolean | null
  storage_path: string
  file_sha256: string
  origin: string
  parent_version_id: string | null
  created_at: string
  processing: "pendente" | "pronto" | "falhou"
  proposedFacts: number
  extractionError: string | null
  /** CV items missing from the profile, still awaiting approval (cv_parsed). */
  profileDiff: CvProfileDiffItem[]
}

export type CvLibrary = { tracks: CvTrackRow[]; versions: CvVersionRow[] }

type RawVersion = Omit<
  CvVersionRow,
  "processing" | "proposedFacts" | "extractionError" | "profileDiff"
> & {
  extracted_text: string | null
  extraction_error: string | null
}

function processingOf(text: string | null): CvVersionRow["processing"] {
  if (text === null) return "pendente"
  return text === "" ? "falhou" : "pronto"
}

export async function loadCvLibrary(ctx: UserContext): Promise<CvLibrary> {
  const [tracks, versions, facts] = await Promise.all([
    ctx.supabase
      .from("cv_tracks")
      .select("id, name, description, keywords")
      .eq("user_id", ctx.user.id)
      .order("name"),
    ctx.supabase
      .from("cv_versions")
      .select(
        "id, track_id, language, label, is_default, storage_path, file_sha256, origin, parent_version_id, created_at, extracted_text, extraction_error"
      )
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("confirmed_facts")
      .select(
        "id, status, statement, created_at, cv_version_id:source_ref->>cv_version_id"
      )
      .eq("user_id", ctx.user.id)
      .order("created_at"),
  ])
  for (const result of [tracks, versions, facts]) {
    if (result.error) throw new Error(result.error.message)
  }
  // Best-effort: the library must still render if the parse table is unavailable.
  const parsed = await ctx.supabase
    .from("cv_parsed")
    .select("cv_version_id, profile_diff, dismissed")
    .eq("user_id", ctx.user.id)
  const diffs = new Map<string, CvProfileDiffItem[]>()
  for (const row of (parsed.data ?? []) as {
    cv_version_id: string
    profile_diff: CvProfileDiffItem[] | null
    dismissed: string[] | null
  }[]) {
    const dismissed = new Set(row.dismissed ?? [])
    diffs.set(
      row.cv_version_id,
      (row.profile_diff ?? []).filter((item) => !dismissed.has(item.key))
    )
  }
  const proposed = new Map<string, number>()
  // Same rule as /app/fatos (visibleFactIds), so the per-CV counts add up to its tab.
  const factRows = (facts.data ?? []) as {
    id: string
    status: FactStatus
    statement: string
    cv_version_id: string | null
  }[]
  const visible = visibleFactIds(factRows).ids
  for (const row of factRows) {
    if (row.status === "proposto" && visible.has(row.id) && row.cv_version_id) {
      proposed.set(
        row.cv_version_id,
        (proposed.get(row.cv_version_id) ?? 0) + 1
      )
    }
  }
  return {
    tracks: (tracks.data ?? []) as CvTrackRow[],
    versions: ((versions.data ?? []) as RawVersion[]).map(
      ({ extracted_text, extraction_error, ...version }) => ({
        ...version,
        processing: processingOf(extracted_text),
        proposedFacts: proposed.get(version.id) ?? 0,
        extractionError: extraction_error,
        profileDiff: diffs.get(version.id) ?? [],
      })
    ),
  }
}

/** Verifies the track belongs to the user (FKs do not enforce the same owner). */
export async function ownsTrack(
  ctx: UserContext,
  trackId: string
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from("cv_tracks")
    .select("id")
    .eq("id", trackId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export type UploadCvInput = {
  file: File
  trackId: string | null
  language: CvLanguage
  label: string | null
}

export type UploadCvResult = {
  id: string
  processing: "inngest" | "inline"
  status: CvVersionRow["processing"]
  proposedFacts: number
  extractionError?: string | null
  duplicate?: boolean
}

export type UploadErrorCode = CvFileErrorCode | "invalid_track"

export type UploadCvOutcome =
  | { ok: true; data: UploadCvResult }
  | { ok: false; error: { code: UploadErrorCode; message: string } }

const labelFromName = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80)

/**
 * P1.2: validates type and size, stores the file in `cvs/{user_id}/`, records the version with
 * SHA-256 and parent version, then runs `cv/uploaded` (Inngest when configured, inline otherwise).
 */
export async function uploadCv(
  ctx: UserContext,
  input: UploadCvInput
): Promise<UploadCvOutcome> {
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  let type: keyof typeof CV_MIME_TYPES
  try {
    type = detectCvFileType(bytes, {
      name: input.file.name,
      mimeType: input.file.type,
    })
  } catch (error) {
    if (error instanceof CvFileError) {
      return { ok: false, error: { code: error.code, message: error.message } }
    }
    throw error
  }
  if (input.trackId && !(await ownsTrack(ctx, input.trackId))) {
    return {
      ok: false,
      error: { code: "invalid_track", message: "Track not found." },
    }
  }

  const userId = ctx.user.id
  const sha = sha256Hex(bytes)
  const existing = await ctx.supabase
    .from("cv_versions")
    .select("id, extracted_text, extraction_error")
    .eq("user_id", userId)
    .eq("file_sha256", sha)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{
      id: string
      extracted_text: string | null
      extraction_error: string | null
    }>()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) {
    const facts = await ctx.supabase
      .from("confirmed_facts")
      .select("id, status, statement, cv_version_id:source_ref->>cv_version_id")
      .eq("user_id", userId)
    if (facts.error) throw new Error(facts.error.message)
    const factRows = (facts.data ?? []) as {
      id: string
      status: FactStatus
      statement: string
      cv_version_id: string | null
    }[]
    const visible = visibleFactIds(factRows).ids
    let proposedFacts = 0
    for (const row of factRows) {
      if (
        row.status === "proposto" &&
        visible.has(row.id) &&
        row.cv_version_id === existing.data.id
      ) {
        proposedFacts += 1
      }
    }
    return {
      ok: true,
      data: {
        id: existing.data.id,
        processing: "inline",
        duplicate: true,
        status: processingOf(existing.data.extracted_text),
        proposedFacts,
        extractionError: existing.data.extraction_error,
      },
    }
  }

  const id = randomUUID()
  const path = `${userId}/${id}.${type}`
  const upload = await ctx.supabase.storage
    .from("cvs")
    .upload(path, bytes, { contentType: CV_MIME_TYPES[type], upsert: false })
  if (upload.error)
    throw new Error(`storage upload failed: ${upload.error.message}`)

  let parentQuery = ctx.supabase
    .from("cv_versions")
    .select("id, is_default")
    .eq("user_id", userId)
    .eq("language", input.language)
  parentQuery = input.trackId
    ? parentQuery.eq("track_id", input.trackId)
    : parentQuery.is("track_id", null)
  const siblings = await parentQuery.order("created_at", { ascending: false })
  if (siblings.error) throw new Error(siblings.error.message)
  const siblingRows = (siblings.data ?? []) as {
    id: string
    is_default: boolean | null
  }[]

  const insert = await ctx.supabase.from("cv_versions").insert({
    id,
    user_id: userId,
    track_id: input.trackId,
    language: input.language,
    label: input.label?.trim() || labelFromName(input.file.name) || "CV",
    is_default:
      input.trackId !== null && !siblingRows.some((row) => row.is_default),
    storage_path: path,
    docx_storage_path: type === "docx" ? path : null,
    file_sha256: sha,
    origin: "upload",
    parent_version_id: input.trackId ? (siblingRows[0]?.id ?? null) : null,
  })
  if (insert.error) {
    await ctx.supabase.storage.from("cvs").remove([path])
    throw new Error(`cv_versions insert failed: ${insert.error.message}`)
  }

  await audit({
    userId,
    actor: "usuario",
    action: "cv.uploaded",
    targetType: "cv_version",
    targetId: id,
    details: {
      type,
      bytes: bytes.byteLength,
      sha256: sha,
      language: input.language,
    },
  })

  if (isInngestConfigured()) {
    await inngest.send(cvUploadedEvent.create({ userId, cvVersionId: id }))
    return {
      ok: true,
      data: { id, processing: "inngest", status: "pendente", proposedFacts: 0 },
    }
  }

  const admin = getAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  // QA round 3: a fact-extraction failure (Gemini schema error) surfaced as "Houve um erro ao
  // salvar o CV" although the version was already stored. The save succeeded; report it so.
  let result: Awaited<ReturnType<typeof processCvUpload>>
  try {
    result = await processCvUpload(
      { admin, audit: new SupabaseAuditSink(admin), actor: "sistema" },
      { userId, cvVersionId: id }
    )
  } catch (error) {
    console.error("uploadCv: inline processing failed", error)
    return {
      ok: true,
      data: {
        id,
        processing: "inline",
        status: "pronto",
        proposedFacts: 0,
        extractionError: null,
      },
    }
  }
  return {
    ok: true,
    data: {
      id,
      processing: "inline",
      status: result.text.status === "ok" ? "pronto" : "falhou",
      proposedFacts: result.facts?.proposed ?? 0,
      extractionError:
        result.text.status === "failed" ? result.text.code : null,
    },
  }
}

/** Signed download URL (5 min) with the neutral filename (CA3.1). */
export async function signedCvDownload(
  ctx: UserContext,
  versionId: string
): Promise<{ url: string; filename: string } | null> {
  const version = await ctx.supabase
    .from("cv_versions")
    .select("storage_path, language")
    .eq("id", versionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle<{ storage_path: string; language: string }>()
  if (version.error) throw new Error(version.error.message)
  if (!version.data) return null

  const profile = await ctx.supabase
    .from("candidate_profiles")
    .select("first_name, last_name, display_name, cv_filename_pattern")
    .eq("user_id", ctx.user.id)
    .maybeSingle<{
      first_name: string | null
      last_name: string | null
      display_name: string
      cv_filename_pattern: string
    }>()
  if (profile.error) throw new Error(profile.error.message)

  const language: CvLanguage = isCvLanguage(version.data.language)
    ? version.data.language
    : "pt-BR"
  const filename = buildCvFilename(
    {
      firstName: profile.data?.first_name,
      lastName: profile.data?.last_name,
      displayName: profile.data?.display_name ?? ctx.user.displayName,
    },
    language,
    profile.data?.cv_filename_pattern,
    version.data.storage_path.endsWith(".docx") ? "docx" : "pdf"
  )
  const signed = await ctx.supabase.storage
    .from("cvs")
    .createSignedUrl(version.data.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: filename,
    })
  if (signed.error || !signed.data) {
    throw new Error(`signed url failed: ${signed.error?.message}`)
  }
  return { url: signed.data.signedUrl, filename }
}
