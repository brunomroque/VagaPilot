import "server-only"

import {
  ACTION_INFO,
  DATA_CATEGORY_KEYS,
  FINAL_SUBMIT_CONFIRMATION,
  PERMISSION_ACTIONS,
  categoryGrantOk,
  isGrant,
  normalizePattern,
  type DataCategory,
  type PermissionAction,
  type PermissionMode,
} from "@vagapilot/core/permissions"

import {
  appendEvidence,
  cloudApplyConsent,
  loadCurrentLegalDocuments,
  requestMeta,
} from "@/lib/legal/server"
import { getAdminClient } from "@/lib/server/admin"

export type PermissionSettingView = {
  action: PermissionAction
  mode: PermissionMode
  categories: DataCategory[]
  finalSubmitConfirmedAt: string | null
  updatedAt: string | null
}

export type PermissionRuleView = {
  id: string
  action: PermissionAction
  pattern: string
  effect: "allow" | "deny"
  categories: DataCategory[]
  source: string
  createdAt: string
  lastUsedAt: string | null
}

export type PermissionEventView = {
  id: string
  action: PermissionAction
  site: string
  decision: "allow" | "deny"
  reason: string
  categories: string[]
  fieldLabel: string | null
  termsUrl: string | null
  termsSha256: string | null
  createdAt: string
}

export type PermissionsView = {
  settings: PermissionSettingView[]
  rules: PermissionRuleView[]
  events: PermissionEventView[]
  notifySensitiveEmail: boolean
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export type Actor = {
  id: string
  email: string | null
  sessionId: string | null
}

const cleanCategories = (input: readonly string[]): DataCategory[] =>
  DATA_CATEGORY_KEYS.filter((c) => input.includes(c))

export async function loadPermissionsView(userId: string): Promise<PermissionsView> {
  const admin = getAdminClient()
  const empty: PermissionsView = {
    settings: PERMISSION_ACTIONS.map((action) => ({
      action,
      mode: ACTION_INFO[action].defaultMode,
      categories: [],
      finalSubmitConfirmedAt: null,
      updatedAt: null,
    })),
    rules: [],
    events: [],
    notifySensitiveEmail: false,
  }
  if (!admin) return empty
  const [perms, rules, events, prefs] = await Promise.all([
    admin
      .from("agent_permissions")
      .select("action_type, mode, categories, final_submit_confirmed_at, updated_at")
      .eq("user_id", userId),
    admin
      .from("agent_permission_rules")
      .select("id, action_type, domain_pattern, effect, categories, source, created_at, last_used_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("agent_permission_events")
      .select("id, action_type, site, decision, reason, categories, field_label, terms_url, terms_sha256, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("agent_permission_prefs").select("notify_sensitive_email").eq("user_id", userId).maybeSingle(),
  ])
  const byAction = new Map(
    ((perms.data ?? []) as {
      action_type: PermissionAction
      mode: PermissionMode
      categories: string[] | null
      final_submit_confirmed_at: string | null
      updated_at: string
    }[]).map((r) => [r.action_type, r])
  )
  return {
    settings: empty.settings.map((s) => {
      const row = byAction.get(s.action)
      return row
        ? {
            action: s.action,
            mode: row.mode,
            categories: cleanCategories(row.categories ?? []),
            finalSubmitConfirmedAt: row.final_submit_confirmed_at,
            updatedAt: row.updated_at,
          }
        : s
    }),
    rules: ((rules.data ?? []) as {
      id: string
      action_type: PermissionAction
      domain_pattern: string
      effect: "allow" | "deny"
      categories: string[] | null
      source: string
      created_at: string
      last_used_at: string | null
    }[]).map((r) => ({
      id: r.id,
      action: r.action_type,
      pattern: r.domain_pattern,
      effect: r.effect,
      categories: cleanCategories(r.categories ?? []),
      source: r.source,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
    events: ((events.data ?? []) as {
      id: string
      action_type: PermissionAction
      site: string
      decision: "allow" | "deny"
      reason: string
      categories: string[] | null
      field_label: string | null
      terms_url: string | null
      terms_sha256: string | null
      created_at: string
    }[]).map((e) => ({
      id: e.id,
      action: e.action_type,
      site: e.site,
      decision: e.decision,
      reason: e.reason,
      categories: e.categories ?? [],
      fieldLabel: e.field_label,
      termsUrl: e.terms_url,
      termsSha256: e.terms_sha256,
      createdAt: e.created_at,
    })),
    notifySensitiveEmail: Boolean(
      (prefs.data as { notify_sensitive_email?: boolean } | null)?.notify_sensitive_email
    ),
  }
}

/**
 * Appends a permission grant/revocation to the user's evidence hash chain, bound to the
 * current Termo de Riscos text. Returns the record hash (stored next to the rule/setting).
 */
async function recordPermissionEvidence(
  actor: Actor,
  kind: "permission_grant" | "permission_revoke",
  key: string,
  categories: readonly DataCategory[],
  typed: string | null
): Promise<string | null> {
  const doc = (await loadCurrentLegalDocuments())["termo-riscos-automacao"]
  if (!doc) return null
  const meta = await requestMeta()
  const checkboxes: Record<string, boolean> = {
    permissao_permanente: true,
    [key]: true,
    ...(kind === "permission_grant" ? { mandato_ciente: true } : {}),
  }
  for (const c of categories) checkboxes[`categoria:${c}`] = true
  const record = await appendEvidence({
    user_id: actor.id,
    email: actor.email,
    action: kind,
    document_id: doc.id,
    document_slug: doc.slug,
    document_version: doc.version,
    document_sha256: doc.sha256,
    checkboxes,
    typed_confirmation: typed?.trim() || null,
    ip: meta.ip,
    user_agent: meta.userAgent,
    session_id: actor.sessionId,
    locale: meta.locale,
  })
  return record?.record_hash ?? null
}

export type GrantInput = {
  categories: readonly string[]
  /** The highlighted mandate text was ticked. */
  acknowledged: boolean
  /** Typed "AUTORIZO DADOS SENSIVEIS" when sensitive categories are included. */
  sensitiveConfirmation?: string | null
  /** final_submit only: typed FINAL_SUBMIT_CONFIRMATION. */
  finalSubmitConfirmation?: string | null
}

/** Validates a grant (ack, categories, sensitive + final submit confirmations, risk term). */
export async function validateGrant(
  userId: string,
  action: PermissionAction,
  grant: GrantInput
): Promise<Result<DataCategory[]>> {
  if (!grant.acknowledged)
    return { ok: false, error: "Marque a ciência do mandato para ativar a permissão." }
  const categories = cleanCategories(grant.categories)
  if (!categories.length) return { ok: false, error: "Marque ao menos uma categoria de dados." }
  if (!categoryGrantOk(categories, grant.sensitiveConfirmation))
    return { ok: false, error: "Dados sensíveis exigem digitar AUTORIZO DADOS SENSIVEIS." }
  if (
    ACTION_INFO[action].needsExtraConfirmation &&
    grant.finalSubmitConfirmation?.trim().toUpperCase() !== FINAL_SUBMIT_CONFIRMATION
  )
    return { ok: false, error: `Para o envio automático, digite ${FINAL_SUBMIT_CONFIRMATION}.` }
  const consent = await cloudApplyConsent(userId)
  if (!consent.ok) return { ok: false, error: "Aceite primeiro o Termo de Riscos em Configurações → Riscos." }
  return { ok: true, data: categories }
}

export async function saveMode(
  actor: Actor,
  action: PermissionAction,
  mode: PermissionMode,
  grant: GrantInput | null
): Promise<Result<null>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  let categories: DataCategory[] = []
  let hash: string | null = null
  if (isGrant(mode)) {
    const valid = await validateGrant(actor.id, action, grant ?? { categories: [], acknowledged: false })
    if (!valid.ok) return valid
    categories = valid.data
    hash = await recordPermissionEvidence(
      actor,
      "permission_grant",
      `perm:${action}:${mode}`,
      categories,
      grant?.sensitiveConfirmation ?? grant?.finalSubmitConfirmation ?? null
    )
    if (!hash) return { ok: false, error: "Não foi possível registrar a ciência." }
  } else {
    hash = await recordPermissionEvidence(actor, "permission_revoke", `perm:${action}:${mode}`, [], null)
  }
  const { error } = await admin.from("agent_permissions").upsert(
    {
      user_id: actor.id,
      action_type: action,
      mode,
      categories,
      final_submit_confirmed_at:
        action === "final_submit" && isGrant(mode) ? new Date().toISOString() : null,
      ack_record_hash: hash,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,action_type" }
  )
  return error ? { ok: false, error: "Não foi possível salvar." } : { ok: true, data: null }
}

export async function addRule(
  actor: Actor,
  action: PermissionAction,
  rawPattern: string,
  effect: "allow" | "deny",
  grant: GrantInput | null,
  source: "settings" | "run_card" = "settings"
): Promise<Result<{ id: string }>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  const pattern = normalizePattern(rawPattern)
  if (!pattern) return { ok: false, error: "Domínio inválido. Use, por exemplo, *.gupy.io ou vagas.empresa.com." }
  let categories: DataCategory[] = []
  let hash: string | null = null
  if (effect === "allow") {
    const valid = await validateGrant(actor.id, action, grant ?? { categories: [], acknowledged: false })
    if (!valid.ok) return valid
    categories = valid.data
    hash = await recordPermissionEvidence(
      actor,
      "permission_grant",
      `perm:${action}:allow:${pattern}`,
      categories,
      grant?.sensitiveConfirmation ?? grant?.finalSubmitConfirmation ?? null
    )
    if (!hash) return { ok: false, error: "Não foi possível registrar a ciência." }
  }
  const { data, error } = await admin
    .from("agent_permission_rules")
    .upsert(
      {
        user_id: actor.id,
        action_type: action,
        domain_pattern: pattern,
        effect,
        categories,
        source,
        ack_record_hash: hash,
      },
      { onConflict: "user_id,action_type,domain_pattern,effect" }
    )
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: "Não foi possível salvar a regra." }
  return { ok: true, data: { id: (data as { id: string }).id } }
}

export async function removeRule(actor: Actor, id: string): Promise<Result<null>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  const { data } = await admin
    .from("agent_permission_rules")
    .delete()
    .eq("id", id)
    .eq("user_id", actor.id)
    .select("action_type, domain_pattern, effect")
    .maybeSingle()
  const row = data as { action_type: string; domain_pattern: string; effect: string } | null
  if (!row) return { ok: false, error: "Regra não encontrada." }
  if (row.effect === "allow")
    await recordPermissionEvidence(actor, "permission_revoke", `perm:${row.action_type}:allow:${row.domain_pattern}`, [], null)
  return { ok: true, data: null }
}

/** Revokes one data category from a mode setting or an allow rule (logged in the chain). */
export async function revokeCategory(
  actor: Actor,
  target: { action: PermissionAction } | { ruleId: string },
  category: DataCategory
): Promise<Result<null>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  if ("ruleId" in target) {
    const { data } = await admin
      .from("agent_permission_rules")
      .select("action_type, domain_pattern, categories")
      .eq("id", target.ruleId)
      .eq("user_id", actor.id)
      .maybeSingle()
    const row = data as { action_type: string; domain_pattern: string; categories: string[] } | null
    if (!row) return { ok: false, error: "Regra não encontrada." }
    await admin
      .from("agent_permission_rules")
      .update({ categories: row.categories.filter((c) => c !== category) })
      .eq("id", target.ruleId)
      .eq("user_id", actor.id)
    await recordPermissionEvidence(actor, "permission_revoke", `perm:${row.action_type}:allow:${row.domain_pattern}`, [category], null)
    return { ok: true, data: null }
  }
  const { data } = await admin
    .from("agent_permissions")
    .select("categories")
    .eq("user_id", actor.id)
    .eq("action_type", target.action)
    .maybeSingle()
  const row = data as { categories: string[] } | null
  if (!row) return { ok: false, error: "Permissão não encontrada." }
  await admin
    .from("agent_permissions")
    .update({ categories: row.categories.filter((c) => c !== category), updated_at: new Date().toISOString() })
    .eq("user_id", actor.id)
    .eq("action_type", target.action)
  await recordPermissionEvidence(actor, "permission_revoke", `perm:${target.action}:categoria`, [category], null)
  return { ok: true, data: null }
}

/** Adds categories to an existing allow rule (card "adicionar categoria"). */
export async function addRuleCategories(
  actor: Actor,
  ruleId: string,
  grant: GrantInput
): Promise<Result<null>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  const { data } = await admin
    .from("agent_permission_rules")
    .select("action_type, domain_pattern, categories, effect")
    .eq("id", ruleId)
    .eq("user_id", actor.id)
    .maybeSingle()
  const row = data as { action_type: PermissionAction; domain_pattern: string; categories: string[]; effect: string } | null
  if (!row || row.effect !== "allow") return { ok: false, error: "Regra não encontrada." }
  const valid = await validateGrant(actor.id, row.action_type, grant)
  if (!valid.ok) return valid
  const merged = cleanCategories([...row.categories, ...valid.data])
  const hash = await recordPermissionEvidence(
    actor,
    "permission_grant",
    `perm:${row.action_type}:allow:${row.domain_pattern}`,
    valid.data,
    grant.sensitiveConfirmation ?? null
  )
  if (!hash) return { ok: false, error: "Não foi possível registrar a ciência." }
  await admin
    .from("agent_permission_rules")
    .update({ categories: merged, ack_record_hash: hash })
    .eq("id", ruleId)
    .eq("user_id", actor.id)
  return { ok: true, data: null }
}

export async function setNotifySensitive(actor: Actor, on: boolean): Promise<Result<null>> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Serviço indisponível." }
  const { error } = await admin
    .from("agent_permission_prefs")
    .upsert({ user_id: actor.id, notify_sensitive_email: on, updated_at: new Date().toISOString() })
  return error ? { ok: false, error: "Não foi possível salvar." } : { ok: true, data: null }
}

export async function currentMode(userId: string, action: PermissionAction): Promise<PermissionMode> {
  const admin = getAdminClient()
  if (!admin) return ACTION_INFO[action].defaultMode
  const { data } = await admin
    .from("agent_permissions")
    .select("mode")
    .eq("user_id", userId)
    .eq("action_type", action)
    .maybeSingle()
  return ((data as { mode?: PermissionMode } | null)?.mode ?? ACTION_INFO[action].defaultMode)
}

/** Sets the mode without a grant record (used after a card "always" already logged one). */
export async function setModeQuiet(userId: string, action: PermissionAction, mode: PermissionMode, hash: string | null) {
  const admin = getAdminClient()
  if (!admin) return
  await admin
    .from("agent_permissions")
    .upsert(
      { user_id: userId, action_type: action, mode, ack_record_hash: hash, updated_at: new Date().toISOString() },
      { onConflict: "user_id,action_type" }
    )
}

export type CardMeta = {
  action?: string
  host?: string
  categories?: string[]
  missing?: string[]
}

/**
 * Applies a run-card click. "Sempre ..." choices persist a domain rule (allow needs the
 * category grant + mandate acknowledgement, logged in the evidence chain); one-off choices
 * persist nothing. Returns whether the decision allows the step.
 */
export async function applyCardChoice(
  actor: Actor,
  meta: CardMeta,
  choice: "once" | "always" | "deny" | "denyAlways",
  grant: GrantInput | null
): Promise<Result<{ allow: boolean; ruleId: string | null }>> {
  const allow = choice === "once" || choice === "always"
  const action = PERMISSION_ACTIONS.find((a) => a === meta.action)
  if (choice === "once" || choice === "deny") return { ok: true, data: { allow, ruleId: null } }
  if (!action || !meta.host) return { ok: false, error: "Não foi possível identificar o site desta ação." }
  if (choice === "always" && ACTION_INFO[action].needsExtraConfirmation)
    return { ok: false, error: "O envio final só pode ser liberado em Configurações → Permissões do agente." }
  const rule = await addRule(
    actor,
    action,
    meta.host,
    choice === "always" ? "allow" : "deny",
    choice === "always"
      ? grant ?? { categories: [...(meta.categories ?? []), ...(meta.missing ?? [])], acknowledged: false }
      : null,
    "run_card"
  )
  if (!rule.ok) return rule
  if (choice === "always") {
    const mode = await currentMode(actor.id, action)
    if (mode === "ask" || mode === "deny") await setModeQuiet(actor.id, action, "allowlist", null)
  }
  return { ok: true, data: { allow, ruleId: rule.data.id } }
}
