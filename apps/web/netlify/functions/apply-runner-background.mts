import { timingSafeEqual } from "node:crypto"

import { runApplyJob } from "@vagapilot/browser-pool/job"

import { applyJobExtras } from "../../lib/apply/job-extras"

/**
 * Netlify background function (15 min budget): runs one segment of an apply run. The job stops
 * itself at ~14 min, saves its phase and re-kicks this function to resume (Steel caps sessions at
 * 15 min too). Only callable with APPLY_RUNNER_SECRET.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.APPLY_RUNNER_SECRET
  if (!secret || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function requeue(runId: string): Promise<void> {
  const site = (process.env.URL ?? "").replace(/\/$/, "")
  const secret = process.env.APPLY_RUNNER_SECRET
  if (!site || !secret) return
  await fetch(`${site}/.netlify/functions/apply-runner-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-apply-runner-secret": secret },
    body: JSON.stringify({ runId }),
  })
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return new Response(null, { status: 405 })
  if (!authorized(request.headers.get("x-apply-runner-secret"))) return new Response(null, { status: 401 })
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null
  const runId = typeof body?.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : null
  if (!runId) return new Response(null, { status: 400 })
  try {
    const result = await runApplyJob(runId, { requeue, ...(await applyJobExtras()) })
    console.info("apply run segment", { runId, phase: result.phase })
  } catch (error) {
    console.error("apply run failed", { runId, reason: error instanceof Error ? error.message : "unknown" })
  }
  return new Response(null, { status: 202 })
}
