import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError } from "@/lib/http"
import { authenticateDevice } from "@/lib/ext/http"
import { fetchPackageForDevice } from "@/lib/ext/packages"

/** GET /api/ext/packages/:id — `id` is the application id from `?vp_app=` (8.4). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return apiError("invalid_request", "Invalid application id.", 400)
  }
  const auth = await authenticateDevice(request)
  if (!auth.ok) return apiError("unauthorized", "Device not authorized.", 401)
  const pkg = await fetchPackageForDevice(auth.userId, id)
  if (!pkg) return apiError("not_found", "Package not found or expired.", 404)
  return NextResponse.json(pkg, { headers: { "cache-control": "no-store" } })
}
