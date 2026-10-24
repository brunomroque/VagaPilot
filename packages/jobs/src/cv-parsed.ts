import type { SupabaseClient } from "@supabase/supabase-js"
import {
  parseCvStructured,
  type ParseCvResult,
  type ParsedCv,
} from "@vagapilot/ai"
import { logAudit } from "@vagapilot/core/audit"
import { normalizeCompanyName } from "@vagapilot/core/blocklist"

import type { CvJobInput, CvProcessingDeps } from "./process-cv.js"

/** One item found in the CV that the profile does not have yet: an approval card, never auto-applied. */
export type CvProfileDiffItem =
  | { key: string; kind: "experience"; value: ParsedCv["experiences"][number] }
  | { key: string; kind: "education"; value: ParsedCv["education"][number] }
  | { key: string; kind: "language"; value: ParsedCv["languages"][number] }
  | { key: string; kind: "skill"; value: { name: string } }
  | {
      key: string
      kind: "certification"
      value: ParsedCv["certifications"][number]
    }

export type ProfileSnapshot = {
  experiences: { company: string; title: string }[]
  educations: { institution: string }[]
  languages: { language: string }[]
  /** Statements of confirmed/proposed facts (skills, tools, certifications). */
  factStatements: string[]
}

const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()

/** Pure: what the parsed CV has that the profile lacks. Keys are stable for "dismiss". */
export function computeProfileDiff(
  parsed: ParsedCv,
  profile: ProfileSnapshot
): CvProfileDiffItem[] {
  const out: CvProfileDiffItem[] = []
  const experiences = new Set(
    profile.experiences.map(
      (e) => `${normalizeCompanyName(e.company)}|${norm(e.title)}`
    )
  )
  for (const e of parsed.experiences) {
    const company = normalizeCompanyName(e.company)
    const key = `${company}|${norm(e.title)}`
    if (experiences.has(key)) continue
    // Same company with a different title is a new role, so it is proposed too.
    out.push({ key: `experience:${key}`, kind: "experience", value: e })
  }
  const schools = new Set(profile.educations.map((e) => norm(e.institution)))
  for (const e of parsed.education) {
    const key = norm(e.institution)
    if (!schools.has(key))
      out.push({
        key: `education:${key}|${norm(e.degree ?? "")}`,
        kind: "education",
        value: e,
      })
  }
  const languages = new Set(profile.languages.map((l) => norm(l.language)))
  for (const l of parsed.languages) {
    const key = norm(l.language)
    if (!languages.has(key))
      out.push({ key: `language:${key}`, kind: "language", value: l })
  }
  const facts = profile.factStatements.map(norm)
  const known = (name: string) => {
    const n = norm(name)
    return n.length > 0 && facts.some((f) => f === n || f.includes(n))
  }
  for (const c of parsed.certifications) {
    if (!known(c.name))
      out.push({
        key: `certification:${norm(c.name)}`,
        kind: "certification",
        value: c,
      })
  }
  for (const s of parsed.skills) {
    if (!known(s))
      out.push({ key: `skill:${norm(s)}`, kind: "skill", value: { name: s } })
  }
  return out
}

async function loadProfileSnapshot(
  admin: SupabaseClient,
  userId: string
): Promise<ProfileSnapshot> {
  const [experiences, educations, languages, facts] = await Promise.all([
    admin.from("experiences").select("company, title").eq("user_id", userId),
    admin.from("educations").select("institution").eq("user_id", userId),
    admin.from("languages").select("language").eq("user_id", userId),
    admin
      .from("confirmed_facts")
      .select("statement")
      .eq("user_id", userId)
      .neq("status", "rejeitado"),
  ])
  for (const r of [experiences, educations, languages, facts]) {
    if (r.error) throw new Error(`profile read failed: ${r.error.message}`)
  }
  return {
    experiences: (experiences.data ?? []) as ProfileSnapshot["experiences"],
    educations: (educations.data ?? []) as ProfileSnapshot["educations"],
    languages: (languages.data ?? []) as ProfileSnapshot["languages"],
    factStatements: ((facts.data ?? []) as { statement: string }[]).map(
      (f) => f.statement
    ),
  }
}

export type CvParseDeps = CvProcessingDeps & {
  parseCv?: (text: string) => Promise<ParseCvResult>
}

/**
 * ATS-style parse at upload: structured JSON stored once in `cv_parsed` (1:1 with the CV
 * version, cascade-deleted with it) plus the profile diff shown as approval cards.
 */
export async function parseAndStoreCv(
  deps: CvParseDeps,
  input: CvJobInput,
  text: string
): Promise<{ items: number; diff: number }> {
  const result = await (deps.parseCv ?? parseCvStructured)(text)
  const profile = await loadProfileSnapshot(deps.admin, input.userId)
  const diff = computeProfileDiff(result.data, profile)
  const { error } = await deps.admin.from("cv_parsed").upsert(
    {
      cv_version_id: input.cvVersionId,
      user_id: input.userId,
      data: result.data,
      profile_diff: diff,
      model: result.model,
      prompt_version: result.promptVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cv_version_id" }
  )
  if (error) throw new Error(`cv_parsed upsert failed: ${error.message}`)
  await logAudit(deps.audit, {
    userId: input.userId,
    actor: deps.actor ?? "worker",
    action: "cv.parsed",
    targetType: "cv_version",
    targetId: input.cvVersionId,
    details: {
      model: result.model,
      prompt_version: result.promptVersion,
      experiences: result.data.experiences.length,
      profile_diff: diff.length,
    },
  })
  return {
    items:
      result.data.experiences.length +
      result.data.education.length +
      result.data.languages.length +
      result.data.certifications.length +
      result.data.skills.length,
    diff: diff.length,
  }
}

/** Reader for ATS score, job comparison, new versions and form filling (no file re-read). */
export async function loadCvParsed(
  client: SupabaseClient,
  userId: string,
  cvVersionId: string
): Promise<{
  data: ParsedCv
  profileDiff: CvProfileDiffItem[]
  dismissed: string[]
} | null> {
  const { data, error } = await client
    .from("cv_parsed")
    .select("data, profile_diff, dismissed")
    .eq("cv_version_id", cvVersionId)
    .eq("user_id", userId)
    .maybeSingle<{
      data: ParsedCv
      profile_diff: CvProfileDiffItem[]
      dismissed: string[]
    }>()
  if (error || !data) return null
  return {
    data: data.data,
    profileDiff: data.profile_diff ?? [],
    dismissed: data.dismissed ?? [],
  }
}
