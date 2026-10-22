import Stripe from "stripe"

import { getStripe } from "@/lib/billing/stripe"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"

/** POST /api/stripe/webhook — idempotent by event.id (spec 11.5, P6.2). */
export async function POST(request: Request) {
  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripe || !secret) {
    return apiError("not_configured", "Stripe webhook is not configured.", 503)
  }

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Admin client missing.", 503)

  const signature = request.headers.get("stripe-signature")
  if (!signature) return apiError("invalid_request", "Missing signature.", 400)

  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch {
    return apiError("invalid_request", "Invalid signature.", 400)
  }

  const seen = await admin
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle()
  if (seen.data) return Response.json({ received: true, duplicate: true })

  await admin.from("stripe_events").insert({ id: event.id })

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    const sub = event.data.object as Stripe.Subscription
    const userId = sub.metadata.user_id
    if (userId) {
      const plan = sub.metadata.plan ?? "pro"
      await admin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: String(sub.customer),
        stripe_subscription_id: sub.id,
        plan,
        status: sub.status,
        current_period_end: new Date(
          (sub as Stripe.Subscription & { current_period_end: number })
            .current_period_end * 1000
        ).toISOString(),
      })
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription
    const userId = sub.metadata.user_id
    if (userId) {
      await admin.from("subscriptions").upsert({
        user_id: userId,
        plan: "free",
        status: "canceled",
        stripe_subscription_id: null,
      })
    }
  }

  return Response.json({ received: true })
}
