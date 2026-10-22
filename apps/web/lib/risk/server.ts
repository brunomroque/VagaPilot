import "server-only"

import { isConsentGranted, type ConsentRecord } from "@vagapilot/core/consents"
import {
  RISK_NOTICE_VERSION,
  riskConsentPurpose,
  type Integration,
} from "@vagapilot/core/integrations"

import type { UserContext } from "@/lib/server/context"

export async function loadConsentRecords(
  ctx: UserContext
): Promise<ConsentRecord[]> {
  const { data } = await ctx.supabase
    .from("consents")
    .select("purpose, granted, created_at, version")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
  return (data ?? []).map((row) => ({
    purpose: String((row as { purpose: string }).purpose),
    granted: Boolean((row as { granted: boolean }).granted),
    createdAt: String((row as { created_at: string }).created_at),
  }))
}

export async function hasRiskAcceptance(
  ctx: UserContext,
  integration: Integration
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from("consents")
    .select("purpose, granted, version, created_at")
    .eq("user_id", ctx.user.id)
    .eq("purpose", riskConsentPurpose(integration))
    .eq("version", RISK_NOTICE_VERSION)
    .order("created_at", { ascending: false })
    .limit(1)
  const row = (data ?? [])[0] as { granted?: boolean } | undefined
  return row?.granted === true
}

export async function recordRiskAcceptance(
  ctx: UserContext,
  integration: Integration
): Promise<void> {
  await ctx.supabase.from("consents").insert({
    user_id: ctx.user.id,
    purpose: riskConsentPurpose(integration),
    version: RISK_NOTICE_VERSION,
    granted: true,
  })
}

export function diversityGranted(records: ConsentRecord[]): boolean {
  return isConsentGranted(records, "diversidade")
}
