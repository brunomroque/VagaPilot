"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { fail, ok, type ActionResult } from "@/lib/action-result"
import type { ConnectedSite, SiteLoginView } from "@/lib/auth-sites/server"
import { getUserContext } from "@/lib/server/context"

async function userId(): Promise<string | { error: ActionResult<never> }> {
  const result = await getUserContext()
  if (!result.ok)
    return { error: fail(result.error.code, result.error.message) }
  return result.ctx.user.id
}

const START_ERRORS: Record<string, string> = {
  pool_disabled: "O navegador na nuvem está desligado (BROWSER_POOL_ENABLED).",
  invalid_url: "Informe o endereço da página de login (https://...).",
  linkedin_disabled: "O LinkedIn fica desligado por padrão (termos de uso).",
  not_configured: "Servidor sem Supabase configurado.",
  insert_failed: "Não consegui iniciar o login.",
  run_not_found: "Candidatura não encontrada.",
}

export async function startSiteLoginAction(
  input: unknown
): Promise<ActionResult<{ loginId: string }>> {
  const parsed = z
    .object({
      url: z.string().min(3).max(2000),
      applyRunId: z.uuid().nullish(),
    })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", START_ERRORS.invalid_url!)
  const uid = await userId()
  if (typeof uid !== "string") return uid.error
  const { startSiteLogin } = await import("@/lib/auth-sites/server")
  const result = await startSiteLogin(uid, parsed.data)
  if ("error" in result)
    return fail(
      result.error === "not_configured" ? "not_configured" : "invalid_request",
      START_ERRORS[result.error] ?? result.error
    )
  return ok(result)
}

export async function loadSiteLoginAction(
  input: unknown
): Promise<ActionResult<SiteLoginView>> {
  const parsed = z.object({ loginId: z.uuid() }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Login inválido.")
  const uid = await userId()
  if (typeof uid !== "string") return uid.error
  const { loadSiteLogin } = await import("@/lib/auth-sites/server")
  const view = await loadSiteLogin(uid, parsed.data.loginId)
  return view ? ok(view) : fail("not_found", "Login não encontrado.")
}

export async function finishSiteLoginAction(
  input: unknown
): Promise<ActionResult<{ updated: boolean }>> {
  const parsed = z
    .object({ loginId: z.uuid(), action: z.enum(["confirm", "cancel"]) })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Pedido inválido.")
  const uid = await userId()
  if (typeof uid !== "string") return uid.error
  const { setSiteLoginStatus } = await import("@/lib/auth-sites/server")
  const updated = await setSiteLoginStatus(
    uid,
    parsed.data.loginId,
    parsed.data.action === "confirm" ? "confirm_requested" : "cancelled"
  )
  revalidatePath("/app/configuracoes")
  return ok({ updated })
}

export async function listConnectedSitesAction(): Promise<
  ActionResult<ConnectedSite[]>
> {
  const uid = await userId()
  if (typeof uid !== "string") return uid.error
  const { listConnectedSites } = await import("@/lib/auth-sites/server")
  return ok(await listConnectedSites(uid))
}

export async function deleteConnectedSiteAction(
  input: unknown
): Promise<ActionResult<{ deleted: boolean }>> {
  const parsed = z
    .object({
      site: z.string().min(1).max(253),
      provider: z.string().min(1).max(40),
    })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Pedido inválido.")
  const uid = await userId()
  if (typeof uid !== "string") return uid.error
  const { deleteConnectedSite } = await import("@/lib/auth-sites/server")
  const deleted = await deleteConnectedSite(
    uid,
    parsed.data.site,
    parsed.data.provider
  )
  revalidatePath("/app/configuracoes")
  return ok({ deleted })
}
