import { getStripe } from "@/lib/billing/stripe"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"

/** POST /api/billing/portal (Stripe Customer Portal, P6.2). */
export async function POST() {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Sign in first.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  const stripe = getStripe()
  if (!stripe)
    return apiError("not_configured", "Stripe is not configured.", 503)

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Admin client missing.", 503)

  const { data } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", session.ctx.user.id)
    .maybeSingle()
  const customerId = (data as { stripe_customer_id?: string } | null)
    ?.stripe_customer_id
  if (!customerId) {
    return apiError("conflict", "No billing customer on file.", 409)
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3100"
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/app/configuracoes`,
  })
  return Response.json({ url: portal.url })
}
