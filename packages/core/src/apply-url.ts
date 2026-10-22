/** Adds the assisted-application hook for the extension (spec 8.4). Pure: no I/O. */
export function buildApplyUrl(
  applyUrl: string | null,
  applicationId: string
): string | null {
  if (!applyUrl) return null
  try {
    const url = new URL(applyUrl)
    url.searchParams.set("vp_app", applicationId)
    return url.toString()
  } catch {
    return applyUrl
  }
}
