import { timingSafeEqual } from "node:crypto"

import { adminFromEnv } from "@vagapilot/browser-pool/job"
import { runLoginJob } from "@vagapilot/browser-pool/login"

/**
 * Netlify background function (15 min): keeps the cloud browser of an interactive login open
 * while the user logs in through the live view, then saves the encrypted session. Only callable
 * with APPLY_RUNNER_SECRET.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.APPLY_RUNNER_SECRET
  if (!secret || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return new Response(null, { status: 405 })
  if (!authorized(request.headers.get("x-apply-runner-secret"))) return new Response(null, { status: 401 })
  const body = (await request.json().catch(() => null)) as { loginId?: unknown } | null
  const loginId = typeof body?.loginId === "string" && /^[0-9a-f-]{36}$/i.test(body.loginId) ? body.loginId : null
  if (!loginId) return new Response(null, { status: 400 })
  const admin = adminFromEnv()
  try {
    const result = await runLoginJob(loginId, {
      admin,
      onSaved: async (row) => {
        if (!row.apply_run_id) return
        // Resume the apply run that was waiting for this login.
        const { data } = await admin
          .from("apply_runs")
          .update({ phase: "queued", lease_until: null, last_error: null, updated_at: new Date().toISOString() })
          .eq("id", row.apply_run_id)
          .eq("user_id", row.user_id)
          .eq("phase", "login_required")
          .select("id")
          .maybeSingle()
        const site = (process.env.URL ?? "").replace(/\/$/, "")
        const secret = process.env.APPLY_RUNNER_SECRET
        if (!data || !site || !secret) return
        await fetch(`${site}/.netlify/functions/apply-runner-background`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-apply-runner-secret": secret },
          body: JSON.stringify({ runId: row.apply_run_id }),
        })
      },
    })
    console.info("login session", { loginId, status: result.status })
  } catch (error) {
    console.error("login session failed", { loginId, reason: error instanceof Error ? error.message : "unknown" })
  }
  return new Response(null, { status: 202 })
}
