import { z } from "zod"
import { getTranslations } from "next-intl/server"

import { proTrialStillAvailable } from "@vagapilot/core/entitlements"

import {
  getStripe,
  priceIdForPlan,
  searchPassPriceId,
} from "@/lib/billing/stripe"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"
import { billingAppUrl } from "@/lib/url"

const bodySchema = z.object({
  plan: z.enum(["pro", "executive", "search_pass"]),
  interval: z.enum(["month", "year"]).optional(),
})

type SubscriptionRow = {
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  plan?: string | null
  status?: string | null
}

/** POST /api/billing/checkout (spec §11.5, §14). */
export async function POST(request: Request) {
  const t = await getTranslations("Billing.errors")
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", t("signIn"), 401)
      : apiError("not_configured", t("notConfigured"), 503)
  }

  const stripe = getStripe()
  if (!stripe) return apiError("not_configured", t("stripe"), 503)

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError("invalid_request", t("invalid"), 400)

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", t("notConfigured"), 503)

  try {
    const userId = session.ctx.user.id
    const email = session.ctx.user.email
    const { data: subRow } = await admin
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, plan, status")
      .eq("user_id", userId)
      .maybeSingle()
    const existing = subRow as SubscriptionRow | null
    let customerId = existing?.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: email ?? undefined, metadata: { user_id: userId } },
        { idempotencyKey: `customer-${userId}` }
      )
      customerId = customer.id
      const again = await admin
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle()
      const winner = (
        again.data as { stripe_customer_id?: string | null } | null
      )?.stripe_customer_id
      if (winner && winner !== customerId) {
        customerId = winner
      } else {
        const saved = await admin.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
        })
        if (saved.error) throw new Error(saved.error.message)
      }
    }

    const plan = parsed.data.plan
    const mode = plan === "search_pass" ? "payment" : "subscription"
    const priceId =
      plan === "search_pass"
        ? searchPassPriceId()
        : priceIdForPlan(plan, parsed.data.interval ?? "month")
    if (!priceId) {
      return apiError("not_configured", t("priceNotConfigured"), 503)
    }

    let priorSubscriptionCount = 0
    if (plan === "pro") {
      try {
        const listed = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 1,
        })
        priorSubscriptionCount = listed.data.length
      } catch {
        priorSubscriptionCount = -1
      }
    }
    const trial =
      plan === "pro" &&
      proTrialStillAvailable({
        plan: existing?.plan,
        status: existing?.status,
        stripeSubscriptionId: existing?.stripe_subscription_id,
        priorSubscriptionCount,
      })

    const metadata = { user_id: userId, plan }
    const appUrl = billingAppUrl()
    const checkout = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/planos?billing=success`,
      cancel_url: `${appUrl}/app/planos?billing=cancel`,
      metadata,
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata,
              ...(trial ? { trial_period_days: 7 } : {}),
            },
          }
        : {}),
    })
    if (!checkout.url)
      return apiError("internal_error", t("checkoutFailed"), 500)
    return Response.json({ url: checkout.url })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("public_app_url:")) {
      return apiError("not_configured", t("publicUrl"), 503)
    }
    console.error("checkout failed", {
      message: error instanceof Error ? error.message : "unknown",
    })
    return apiError("internal_error", t("checkoutFailed"), 500)
  }
}
