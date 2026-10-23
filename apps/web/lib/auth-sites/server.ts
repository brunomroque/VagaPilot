import "server-only"

import { after } from "next/server"

import {
  createAdapter,
  isPoolEnabled,
  listAuthStates,
  normalizeLoginUrl,
  secretsFromEnv,
  siteOf,
} from "@vagapilot/browser-pool"

import { kickApplyRun } from "@/lib/apply/server"
import { getAdminClient } from "@/lib/server/admin"

export type ConnectedSite = {
  site: string
  provider: string
  status: "active" | "expired"
  expiresAt: string | null
  updatedAt: string
  native: boolean
}

export type SiteLoginView = {
  id: string
  site: string
  status: string
  liveViewUrl: string | null
  provider: string | null
  lastError: string | null
  expiresAt: string | null
}

const OPEN = ["starting", "opening", "waiting_user", "confirm_requested"]

/** Connected sites of the signed-in user. Never returns the sealed state. */
export async function listConnectedSites(
  userId: string
): Promise<ConnectedSite[]> {
  const admin = getAdminClient()
  if (!admin) return []
  const rows = await listAuthStates(admin, userId)
  return rows.map((r) => ({
    site: r.site,
    provider: r.provider,
    status:
      r.status === "active" &&
      (!r.expires_at || new Date(r.expires_at) > new Date())
        ? "active"
        : "expired",
    expiresAt: r.expires_at,
    updatedAt: r.updated_at,
    native: Boolean(r.native_ref),
  }))
}

/** Background worker: Netlify background function (15 min); inline after() in `next dev`. */
export async function kickLoginJob(loginId: string): Promise<void> {
  const secret = process.env.APPLY_RUNNER_SECRET
  const siteUrl =
    process.env.URL ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NETLIFY && siteUrl && secret) {
    await fetch(
      `${siteUrl.replace(/\/$/, "")}/.netlify/functions/login-session-background`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-apply-runner-secret": secret,
        },
        body: JSON.stringify({ loginId }),
      }
    ).catch((error: unknown) =>
      console.error("login session kick failed", { reason: String(error) })
    )
    return
  }
  const admin = getAdminClient()
  if (!admin) return
  after(async () => {
    const { runLoginJob } = await import("@vagapilot/browser-pool/login")
    await runLoginJob(loginId, {
      admin,
      onSaved: async (row) => {
        if (row.apply_run_id)
          await resumeAfterLogin(row.user_id, row.apply_run_id)
      },
    }).catch((error: unknown) =>
      console.error("login session failed", {
        reason: error instanceof Error ? error.message : "unknown",
      })
    )
  })
}

/** Puts the run that was waiting for this login back in the queue. */
export async function resumeAfterLogin(
  userId: string,
  applyRunId: string
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const { data } = await admin
    .from("apply_runs")
    .update({
      phase: "queued",
      lease_until: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applyRunId)
    .eq("user_id", userId)
    .eq("phase", "login_required")
    .select("id")
    .maybeSingle()
  if (data) await kickApplyRun(applyRunId)
}

export async function startSiteLogin(
  userId: string,
  input: { url: string; applyRunId?: string | null }
): Promise<
  | { loginId: string }
  | {
      error:
        | "pool_disabled"
        | "invalid_url"
        | "linkedin_disabled"
        | "not_configured"
        | "insert_failed"
        | "run_not_found"
    }
> {
  if (!isPoolEnabled()) return { error: "pool_disabled" }
  const url = normalizeLoginUrl(input.url)
  if (!url) return { error: "invalid_url" }
  const site = siteOf(url)
  if (site === "linkedin.com" && process.env.APPLY_LINKEDIN_ENABLED !== "true")
    return { error: "linkedin_disabled" }
  const admin = getAdminClient()
  if (!admin) return { error: "not_configured" }
  if (input.applyRunId) {
    const { data } = await admin
      .from("apply_runs")
      .select("id")
      .eq("id", input.applyRunId)
      .eq("user_id", userId)
      .maybeSingle()
    if (!data) return { error: "run_not_found" }
  }
  // One open login per site: a new attempt cancels the previous one.
  await admin
    .from("browser_login_sessions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("site", site)
    .in("status", OPEN)
  const inserted = await admin
    .from("browser_login_sessions")
    .insert({
      user_id: userId,
      site,
      login_url: url,
      apply_run_id: input.applyRunId ?? null,
      status: "starting",
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) return { error: "insert_failed" }
  const loginId = (inserted.data as { id: string }).id
  await kickLoginJob(loginId)
  return { loginId }
}

export async function loadSiteLogin(
  userId: string,
  loginId: string
): Promise<SiteLoginView | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("browser_login_sessions")
    .select("id, site, status, live_view_url, provider, last_error, expires_at")
    .eq("id", loginId)
    .eq("user_id", userId)
    .maybeSingle()
  const row = data as {
    id: string
    site: string
    status: string
    live_view_url: string | null
    provider: string | null
    last_error: string | null
    expires_at: string | null
  } | null
  if (!row) return null
  return {
    id: row.id,
    site: row.site,
    status: row.status,
    liveViewUrl:
      row.status === "waiting_user" || row.status === "confirm_requested"
        ? row.live_view_url
        : null,
    provider: row.provider,
    lastError: row.last_error,
    expiresAt: row.expires_at,
  }
}

/** "Pronto" (save) or "Cancelar". The worker picks the new status up within a few seconds. */
export async function setSiteLoginStatus(
  userId: string,
  loginId: string,
  status: "confirm_requested" | "cancelled"
): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from("browser_login_sessions")
    .update({ status, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", loginId)
    .eq("user_id", userId)
    .in("status", status === "cancelled" ? OPEN : ["waiting_user"])
    .select("id")
    .maybeSingle()
  return Boolean(data)
}

/** Deletes the saved login and, best effort, the provider's Context/Profile. */
export async function deleteConnectedSite(
  userId: string,
  site: string,
  provider: string
): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from("browser_auth_states")
    .delete()
    .eq("user_id", userId)
    .eq("site", site)
    .eq("provider", provider)
    .select("native_ref")
    .maybeSingle()
  const ref = (data as { native_ref?: string | null } | null)?.native_ref
  if (ref) {
    const { data: config } = await admin
      .from("browser_providers")
      .select("provider, secret_env_var, project_env_var")
      .eq("provider", provider)
      .order("priority", { ascending: true })
      .limit(1)
      .maybeSingle()
    const cfg = config as {
      provider: Parameters<typeof createAdapter>[0]
      secret_env_var: string
      project_env_var: string | null
    } | null
    const secrets = cfg
      ? secretsFromEnv({
          secretEnvVar: cfg.secret_env_var,
          projectEnvVar: cfg.project_env_var,
        })
      : null
    if (cfg && secrets) {
      try {
        await createAdapter(cfg.provider, secrets).deletePersistence?.(ref)
      } catch {
        // The provider object is orphaned but holds no app secret; ignore.
      }
    }
  }
  return Boolean(data)
}
