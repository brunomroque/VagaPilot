import { loadRunScreenshot } from "@/lib/apply/server"
import { getUserContext } from "@/lib/server/context"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 })
  const auth = await getUserContext()
  if (!auth.ok) return new Response(null, { status: 401 })
  const image = await loadRunScreenshot(auth.ctx, id)
  if (!image) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(image), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" },
  })
}
