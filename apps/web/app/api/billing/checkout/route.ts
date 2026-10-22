import { z } from "zod"

import {
  getStripe,
  priceIdForPlan,
  searchPassPriceId,
} from "@/lib/billing/stripe"
import { getUserPlan } from "@/lib/entitlements/server"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"

const bodySchema = z.object({
  plan: z.enum(["pro", "executive", "search_pass"]),
  interval: z.enum(["month", "year"]).optional(),
})

/** POST /api/billing/checkout (spec 8.5, §14, P6.2). */
export async function POST(request: Request) {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Sign in first.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  const stripe = getStripe()
  if (!stripe)
    return apiError("not_configured", "Stripe is not configured.", 503)

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiError("invalid_request", "Invalid checkout body.", 400)

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Admin client missing.", 503)

  const userId = session.ctx.user.id
  const email = session.ctx.user.email
  const { data: subRow } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle()
  let customerId = (subRow as { stripe_customer_id?: string } | null)
    ?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email ?? undefined,
      metadata: { user_id: userId },
    })
    customerId = customer.id
    await admin.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      plan: await getUserPlan(admin, userId),
    })
  }

  let priceId: string | null = null
  let mode: "subscription" | "payment" = "subscription"
  if (parsed.data.plan === "search_pass") {
    priceId = searchPassPriceId()
    mode = "payment"
  } else {
    priceId = priceIdForPlan(parsed.data.plan, parsed.data.interval ?? "month")
  }
  if (!priceId) {
    return apiError("not_configured", "Stripe price id is not configured.", 503)
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3100"
  const checkout = await stripe.checkout.sessions.create({
    mode,
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/app/configuracoes?billing=success`,
    cancel_url: `${appUrl}/app/planos?billing=cancel`,
    subscription_data:
      mode === "subscription" && parsed.data.plan === "pro"
        ? {
            trial_period_days: 7,
            metadata: { user_id: userId, plan: parsed.data.plan },
          }
        : { metadata: { user_id: userId, plan: parsed.data.plan } },
    metadata: { user_id: userId, plan: parsed.data.plan },
  })

  if (!checkout.url)
    return apiError("internal_error", "Checkout session failed.", 500)
  return Response.json({ url: checkout.url })
}
