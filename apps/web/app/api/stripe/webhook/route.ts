import Stripe from "stripe"

import {
  isPlanId,
  searchPassPeriodEndIso,
  subscriptionPeriodEndIso,
} from "@vagapilot/core/entitlements"
import { isUniqueViolation } from "@vagapilot/core/postgres"

import { getStripe } from "@/lib/billing/stripe"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"

type Admin = NonNullable<ReturnType<typeof getAdminClient>>

function periodEndIso(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as
    { current_period_end?: number } | undefined
  const root = (sub as Stripe.Subscription & { current_period_end?: number })
    .current_period_end
  return subscriptionPeriodEndIso({
    itemPeriodEnd: item?.current_period_end,
    currentPeriodEnd: root,
  })
}

async function applySubscription(
  admin: Admin,
  sub: Stripe.Subscription
): Promise<void> {
  const userId = sub.metadata?.user_id
  if (!userId) return
  const metadataPlan = sub.metadata?.plan
  const plan =
    isPlanId(metadataPlan) &&
    metadataPlan !== "search_pass" &&
    metadataPlan !== "free"
      ? metadataPlan
      : "pro"
  const end = periodEndIso(sub)
  const row: Record<string, unknown> = {
    user_id: userId,
    stripe_customer_id: String(sub.customer),
    stripe_subscription_id: sub.id,
    plan,
    status: sub.status,
  }
  if (end) row.current_period_end = end
  const { error } = await admin.from("subscriptions").upsert(row)
  if (error) throw new Error(error.message)
}

async function applySubscriptionDeleted(
  admin: Admin,
  sub: Stripe.Subscription
): Promise<void> {
  const userId = sub.metadata?.user_id
  if (!userId) return
  const end = periodEndIso(sub) ?? new Date().toISOString()
  const { error } = await admin.from("subscriptions").upsert({
    user_id: userId,
    plan: "free",
    status: "canceled",
    stripe_subscription_id: null,
    current_period_end: end,
  })
  if (error) throw new Error(error.message)
}

async function applySearchPass(
  admin: Admin,
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.mode !== "payment") return
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return
  }
  const userId = session.metadata?.user_id
  if (!userId || session.metadata?.plan !== "search_pass") return
  const row: Record<string, unknown> = {
    user_id: userId,
    plan: "search_pass",
    status: "active",
    current_period_end: searchPassPeriodEndIso(session.created),
  }
  if (session.customer) row.stripe_customer_id = String(session.customer)
  const { error } = await admin.from("subscriptions").upsert(row)
  if (error) throw new Error(error.message)
}

async function applyEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    await applySearchPass(admin, event.data.object)
    return
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    await applySubscription(admin, event.data.object)
    return
  }
  if (event.type === "customer.subscription.deleted") {
    await applySubscriptionDeleted(admin, event.data.object)
  }
}

/** POST /api/stripe/webhook — idempotent by event.id (spec §11.5, §14). */
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

  try {
    await applyEvent(admin, event)
  } catch (error) {
    console.error("stripe webhook handler failed", {
      id: event.id,
      type: event.type,
      message: error instanceof Error ? error.message : "unknown",
    })
    return apiError("internal_error", "Webhook handler failed.", 500)
  }

  const inserted = await admin.from("stripe_events").insert({ id: event.id })
  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) {
      return Response.json({ received: true, duplicate: true })
    }
    console.error("stripe webhook event insert failed", {
      id: event.id,
      type: event.type,
      message: inserted.error.message,
    })
    return apiError("internal_error", "Could not record the event.", 500)
  }

  return Response.json({ received: true })
}
