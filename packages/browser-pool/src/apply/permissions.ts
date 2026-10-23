import {
  ACTION_INFO,
  PERMISSION_ACTIONS,
  resolvePermission,
  type DataCategory,
  type PermissionAction,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRule,
  type PermissionSetting,
} from "@vagapilot/core/permissions"
import { siteRiskLevel, type SiteRiskLevel } from "@vagapilot/core/risks"
import type { SupabaseClient } from "@supabase/supabase-js"

/** Account/e-mail actions the runner asks before doing (UnknownQuestion.permission). */
export type GatedAction = "create_site_account" | "open_email_link" | "use_email_code"

export const PERMISSION_ALLOW = "Permitir"
export const PERMISSION_DENY = "Negar"

export function permissionLabel(action: PermissionAction): string {
  return `Permissão do agente: ${ACTION_INFO[action].title}`
}

export type PermissionState = {
  settings: Partial<Record<PermissionAction, PermissionSetting>>
  rules: PermissionRule[]
  siteRisk: SiteRiskLevel | null
  /** Explicit rows only: the marketing default "deny" never fails a run, it asks. */
  explicit: Set<PermissionAction>
}

export const EMPTY_PERMISSIONS: PermissionState = {
  settings: {},
  rules: [],
  siteRisk: null,
  explicit: new Set(),
}

export async function loadPermissionState(
  admin: SupabaseClient,
  userId: string,
  host: string
): Promise<PermissionState> {
  const [perms, rules, levels] = await Promise.all([
    admin
      .from("agent_permissions")
      .select("action_type, mode, final_submit_confirmed_at, categories")
      .eq("user_id", userId),
    admin
      .from("agent_permission_rules")
      .select("id, action_type, domain_pattern, effect, categories")
      .eq("user_id", userId),
    admin.from("site_risk_levels").select("domain, level"),
  ])
  const settings: PermissionState["settings"] = {}
  const explicit = new Set<PermissionAction>()
  for (const row of (perms.data ?? []) as {
    action_type: string
    mode: string
    final_submit_confirmed_at: string | null
    categories: string[] | null
  }[]) {
    if (!(PERMISSION_ACTIONS as readonly string[]).includes(row.action_type)) continue
    const action = row.action_type as PermissionAction
    settings[action] = {
      mode: row.mode as PermissionMode,
      confirmedAt: row.final_submit_confirmed_at,
      categories: (row.categories ?? []) as DataCategory[],
    }
    explicit.add(action)
  }
  return {
    settings,
    explicit,
    rules: ((rules.data ?? []) as {
      id: string
      action_type: string
      domain_pattern: string
      effect: "allow" | "deny"
      categories: string[] | null
    }[]).map((r) => ({
      id: r.id,
      action: r.action_type as PermissionAction,
      pattern: r.domain_pattern,
      effect: r.effect,
      categories: (r.categories ?? []) as DataCategory[],
    })),
    siteRisk: siteRiskLevel(
      host,
      (levels.data ?? []) as { domain: string; level: SiteRiskLevel }[]
    ),
  }
}

export function decide(
  state: PermissionState,
  action: PermissionAction,
  host: string,
  categories: readonly DataCategory[] = []
): PermissionDecision {
  const d = resolvePermission({
    action,
    host,
    settings: state.settings,
    rules: state.rules,
    siteRisk: state.siteRisk,
    categories,
  })
  if (d.reason === "mode_deny" && !state.explicit.has(action))
    return { decision: "ask", reason: "mode_ask" }
  return d
}

/** Append-only activity entry + last_used_at of the rule that decided. Never throws. */
export async function recordPermissionUse(
  admin: SupabaseClient,
  entry: {
    user_id: string
    run_id: string
    action_type: PermissionAction
    site: string
    decision: "allow" | "deny"
    reason: string
    rule_id?: string | null
    categories?: readonly string[]
    field_label?: string | null
    terms_url?: string | null
    terms_sha256?: string | null
  }
): Promise<void> {
  await admin
    .from("agent_permission_events")
    .insert({
      ...entry,
      rule_id: entry.rule_id ?? null,
      categories: [...(entry.categories ?? [])],
    })
    .then(
      () => undefined,
      () => undefined
    )
  if (entry.rule_id)
    await admin
      .from("agent_permission_rules")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", entry.rule_id)
      .eq("user_id", entry.user_id)
      .then(
        () => undefined,
        () => undefined
      )
}

/** "Dados sensíveis enviados": sealed with AUTH_STATE_ENCRYPTION_KEY, AAD bound to user + run. */
export function sensitiveReportAad(userId: string, runId: string): Buffer {
  return Buffer.from(`vp-sensitive|${userId}|${runId}`, "utf8")
}
