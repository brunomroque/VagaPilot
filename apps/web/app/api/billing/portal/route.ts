import { getTranslations } from "next-intl/server"

import { getStripe } from "@/lib/billing/stripe"
import { apiError } from "@/lib/http"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"
import { billingAppUrl } from "@/lib/url"

/** POST /api/billing/portal (Stripe Customer Portal, spec §11.5). */
export async function POST() {
  const t = await getTranslations("Billing.errors")
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", t("signIn"), 401)
      : apiError("not_configured", t("notConfigured"), 503)
  }

  const stripe = getStripe()
  if (!stripe) return apiError("not_configured", t("stripe"), 503)

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", t("notConfigured"), 503)

  const { data } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", session.ctx.user.id)
    .maybeSingle()
  const customerId = (data as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id
  if (!customerId) return apiError("conflict", t("noCustomer"), 409)

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${billingAppUrl()}/app/planos`,
    })
    return Response.json({ url: portal.url })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("public_app_url:")) {
      return apiError("not_configured", t("publicUrl"), 503)
    }
    console.error("billing portal failed", {
      message: error instanceof Error ? error.message : "unknown",
    })
    return apiError("internal_error", t("checkoutFailed"), 500)
  }
}
