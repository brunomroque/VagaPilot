import "server-only"

import { createHash } from "node:crypto"

import type { UserContext } from "@/lib/server/context"

type ApprovalRow = {
  id: string
  kind: string
  status: string
  preview: Record<string, unknown>
  preview_sha256: string
  expires_at: string
}

export async function verifyApprovalForApply(
  ctx: UserContext,
  approvalId: string,
  expectedKind: string
): Promise<
  | { ok: true; preview: Record<string, unknown> }
  | { ok: false; code: string; message: string }
> {
  const { data, error } = await ctx.supabase
    .from("approvals")
    .select("id, kind, status, preview, preview_sha256, expires_at")
    .eq("id", approvalId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (error || !data) {
    return { ok: false, code: "not_found", message: "Approval not found." }
  }
  const row = data as ApprovalRow
  if (row.kind !== expectedKind) {
    return { ok: false, code: "conflict", message: "Wrong approval kind." }
  }
  if (row.status !== "aprovada") {
    return { ok: false, code: "conflict", message: "Approval not approved." }
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, code: "conflict", message: "Approval expired." }
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(row.preview))
    .digest("hex")
  if (hash !== row.preview_sha256) {
    return { ok: false, code: "conflict", message: "Preview hash mismatch." }
  }
  return { ok: true, preview: row.preview }
}
