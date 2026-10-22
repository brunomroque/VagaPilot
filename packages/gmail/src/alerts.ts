/**
 * LinkedIn job alerts (RF15.2): alert e-mails the user already receives become batches of job
 * links for ingestion with fit (P2). Only public job URLs leave this module; never the body.
 */

/** F14: at most 20 links per batch. */
export const MAX_ALERT_LINKS = 20

const LINKEDIN_JOB =
  /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#\s]*-)?(\d{6,})/gi

/** Canonical public job URLs found in a LinkedIn alert (`https://www.linkedin.com/jobs/view/{id}/`). */
export function parseLinkedInJobAlert(body: string): string[] {
  const ids = new Set<string>()
  for (const match of body.matchAll(LINKEDIN_JOB)) {
    if (match[1]) ids.add(match[1])
    if (ids.size >= MAX_ALERT_LINKS) break
  }
  return [...ids].map((id) => `https://www.linkedin.com/jobs/view/${id}/`)
}

export type JobAlertBatch = {
  userId: string
  emailThreadId: string
  receivedAt: Date
  urls: string[]
}

/**
 * Called by the sync for every alert with links. P2 (ingestion) plugs `job/ingest.requested`
 * here; until then the links stay in `email_threads.extracted.links`.
 */
export type JobAlertHandler = (batch: JobAlertBatch) => Promise<void>
