import "server-only"

import Stripe from "stripe"

import { nonBlank } from "@vagapilot/core/app-url"

import type { PlanId } from "@vagapilot/core/entitlements"

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key, { apiVersion: "2026-09-30.endive" })
}

export function priceIdForPlan(
  plan: Extract<PlanId, "pro" | "executive">,
  interval: "month" | "year"
): string | null {
  const map: Record<string, string | undefined> = {
    "pro-month": process.env.STRIPE_PRICE_PRO_MONTHLY,
    "pro-year": process.env.STRIPE_PRICE_PRO_YEARLY,
    "executive-month": process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY,
    "executive-year": process.env.STRIPE_PRICE_EXECUTIVE_YEARLY,
  }
  return nonBlank(map[`${plan}-${interval === "month" ? "month" : "year"}`])
}

export function searchPassPriceId(): string | null {
  return nonBlank(process.env.STRIPE_PRICE_SEARCH_PASS)
}

/**
 * Seed hint in centavos. Yearly figures are the annual charge
 * (12 × the annual monthly rate in ESPEC §14): Pro R$ 468, Executive R$ 1.188.
 * Price IDs stay in env and must be confirmed in the Stripe dashboard.
 * See docs/CONFIG_STRIPE_RESEND.md.
 */
export const BILLING_SEED_HINT = {
  proMonthlyBrl: 4_900,
  proYearlyBrl: 468_00,
  executiveMonthlyBrl: 12_900,
  executiveYearlyBrl: 1_188_00,
  searchPassBrl: 29_900,
  trialDays: 7,
} as const
