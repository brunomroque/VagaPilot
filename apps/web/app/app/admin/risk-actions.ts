"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { isAppAdmin } from "@/lib/admin/server"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import { getUserContext } from "@/lib/server/context"

type Result = { ok: true } | { ok: false; error: string }

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, "Domínio inválido (ex.: linkedin.com).")

const levelSchema = z.object({
  domain: domainSchema,
  level: z.enum(["baixo", "medio", "alto"]),
  note: z.string().max(300).nullable(),
})

async function adminUser(): Promise<string | null> {
  const auth = await getUserContext()
  if (!auth.ok) return null
  return (await isAppAdmin(auth.ctx.supabase)) ? auth.ctx.user.id : null
}

/** Admin: sets the automation-risk level of a domain (badge + alerts). Audited. */
export async function upsertSiteRiskLevelAction(input: unknown): Promise<Result> {
  const userId = await adminUser()
  if (!userId) return { ok: false, error: "Acesso negado." }
  const parsed = levelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." }
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Servidor não configurado." }
  const { error } = await admin.from("site_risk_levels").upsert({
    ...parsed.data,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: "Não foi possível salvar." }
  await audit({
    userId,
    actor: "usuario",
    action: "browser_pool.site_risk_changed",
    targetType: "site_risk_level",
    targetId: parsed.data.domain,
    details: { level: parsed.data.level },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true }
}

export async function deleteSiteRiskLevelAction(input: unknown): Promise<Result> {
  const userId = await adminUser()
  if (!userId) return { ok: false, error: "Acesso negado." }
  const parsed = z.object({ domain: domainSchema }).safeParse(input)
  if (!parsed.success) return { ok: false, error: "Domínio inválido." }
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Servidor não configurado." }
  await admin.from("site_risk_levels").delete().eq("domain", parsed.data.domain)
  await audit({
    userId,
    actor: "usuario",
    action: "browser_pool.site_risk_changed",
    targetType: "site_risk_level",
    targetId: parsed.data.domain,
    details: { level: null },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true }
}
