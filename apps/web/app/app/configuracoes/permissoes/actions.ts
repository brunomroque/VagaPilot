"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { DATA_CATEGORY_KEYS, PERMISSION_ACTIONS, PERMISSION_MODES } from "@vagapilot/core/permissions"

import { sessionIdFromClaims } from "@/lib/legal/server"
import {
  addRule,
  addRuleCategories,
  removeRule,
  revokeCategory,
  saveMode,
  setNotifySensitive,
  type Actor,
} from "@/lib/permissions/server"
import { audit } from "@/lib/server/audit"
import { getUserContext } from "@/lib/server/context"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const PATH = "/app/configuracoes/permissoes"
const action = z.enum(PERMISSION_ACTIONS)
const category = z.enum(DATA_CATEGORY_KEYS as [string, ...string[]])
const grant = z
  .object({
    categories: z.array(category).max(20),
    acknowledged: z.boolean(),
    sensitiveConfirmation: z.string().max(80).nullable().optional(),
    finalSubmitConfirmation: z.string().max(80).nullable().optional(),
  })
  .nullable()

async function actor(): Promise<Actor | null> {
  const auth = await getUserContext()
  if (!auth.ok) return null
  const { data: claims } = await auth.ctx.supabase.auth.getClaims()
  return {
    id: auth.ctx.user.id,
    email: auth.ctx.user.email,
    sessionId: sessionIdFromClaims(claims?.claims as Record<string, unknown> | undefined),
  }
}

async function changed(a: Actor, details: Record<string, unknown>) {
  await audit({
    userId: a.id,
    actor: "usuario",
    action: "agent_permission.changed",
    targetType: "agent_permission",
    targetId: String(details.action ?? details.rule_id ?? "prefs"),
    details,
  }).catch(() => undefined)
  revalidatePath(PATH)
}

export async function setPermissionModeAction(input: unknown): Promise<Result<null>> {
  const p = z.object({ action, mode: z.enum(PERMISSION_MODES), grant }).safeParse(input)
  if (!p.success) return { ok: false, error: "Dados inválidos." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const r = await saveMode(a, p.data.action, p.data.mode, p.data.grant)
  if (r.ok) await changed(a, { action: p.data.action, mode: p.data.mode, categories: p.data.grant?.categories ?? [] })
  return r
}

export async function addPermissionRuleAction(input: unknown): Promise<Result<{ id: string }>> {
  const p = z
    .object({ action, pattern: z.string().min(1).max(253), effect: z.enum(["allow", "deny"]), grant })
    .safeParse(input)
  if (!p.success) return { ok: false, error: "Dados inválidos." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const r = await addRule(a, p.data.action, p.data.pattern, p.data.effect, p.data.grant)
  if (r.ok) await changed(a, { action: p.data.action, rule_id: r.data.id, effect: p.data.effect, pattern: p.data.pattern })
  return r
}

export async function removePermissionRuleAction(input: unknown): Promise<Result<null>> {
  const p = z.object({ id: z.uuid() }).safeParse(input)
  if (!p.success) return { ok: false, error: "Regra inválida." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const r = await removeRule(a, p.data.id)
  if (r.ok) await changed(a, { rule_id: p.data.id, removed: true })
  return r
}

export async function revokePermissionCategoryAction(input: unknown): Promise<Result<null>> {
  const p = z
    .object({ action: action.optional(), ruleId: z.uuid().optional(), category })
    .safeParse(input)
  if (!p.success || (!p.data.action && !p.data.ruleId)) return { ok: false, error: "Dados inválidos." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const target = p.data.ruleId ? { ruleId: p.data.ruleId } : { action: p.data.action! }
  const r = await revokeCategory(a, target, p.data.category as never)
  if (r.ok) await changed(a, { ...target, revoked_category: p.data.category })
  return r
}

export async function addRuleCategoriesAction(input: unknown): Promise<Result<null>> {
  const p = z.object({ ruleId: z.uuid(), grant: grant.unwrap() }).safeParse(input)
  if (!p.success) return { ok: false, error: "Dados inválidos." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const r = await addRuleCategories(a, p.data.ruleId, p.data.grant)
  if (r.ok) await changed(a, { rule_id: p.data.ruleId, added_categories: p.data.grant.categories })
  return r
}

export async function setNotifySensitiveAction(input: unknown): Promise<Result<null>> {
  const p = z.object({ on: z.boolean() }).safeParse(input)
  if (!p.success) return { ok: false, error: "Dados inválidos." }
  const a = await actor()
  if (!a) return { ok: false, error: "Entre novamente." }
  const r = await setNotifySensitive(a, p.data.on)
  if (r.ok) await changed(a, { notify_sensitive_email: p.data.on })
  return r
}
