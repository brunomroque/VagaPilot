import { NextResponse } from "next/server"

import { buildCertificate } from "@/lib/legal/server"
import { getUserContext } from "@/lib/server/context"

/** Downloads the JSON certificate of one of the user's own acceptance records. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getUserContext()
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  const cert = await buildCertificate(id, auth.ctx.user.id)
  if (!cert) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return new NextResponse(JSON.stringify(cert, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="aceite-${cert.record.document_slug}-${cert.record.document_version}-${id.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  })
}
