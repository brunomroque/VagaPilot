/**
 * Validates CV adjustments are append-only (spec 6.2).
 */

export type CvExperienceSlice = {
  company: string
  role: string
  start: string
  end: string | null
}

export function extractExperienceSlices(text: string): CvExperienceSlice[] {
  const lines = text.split(/\n/)
  const slices: CvExperienceSlice[] = []
  const header =
    /^(?<company>.+?)\s*[·|–-]\s*(?<role>.+?)\s*\((?<start>\d{2}\/\d{4})\s*(?:–|-)\s*(?<end>\d{2}\/\d{4}|atual)\)/i
  for (const line of lines) {
    const match = header.exec(line.trim())
    const g = match?.groups
    if (!g?.company || !g.role || !g.start) continue
    slices.push({
      company: g.company.trim(),
      role: g.role.trim(),
      start: g.start,
      end: g.end?.toLowerCase() === "atual" ? null : (g.end ?? null),
    })
  }
  return slices
}

export function assertCvAppendOnly(input: {
  parentText: string
  nextText: string
}): { ok: true } | { ok: false; code: "cv_destructive_change" } {
  const parent = extractExperienceSlices(input.parentText)
  const next = extractExperienceSlices(input.nextText)
  if (parent.length === 0) return { ok: true }
  if (next.length < parent.length)
    return { ok: false, code: "cv_destructive_change" }
  for (let i = 0; i < parent.length; i += 1) {
    const a = parent[i]
    const b = next[i]
    if (!a || !b) return { ok: false, code: "cv_destructive_change" }
    if (
      a.company !== b.company ||
      a.role !== b.role ||
      a.start !== b.start ||
      a.end !== b.end
    ) {
      return { ok: false, code: "cv_destructive_change" }
    }
  }
  return { ok: true }
}
