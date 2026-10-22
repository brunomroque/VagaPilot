import "server-only"

import Stripe from "stripe"

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
  return (
    map[`${plan}-${interval === "month" ? "month" : "year"}`]?.trim() ?? null
  )
}

export function searchPassPriceId(): string | null {
  return process.env.STRIPE_PRICE_SEARCH_PASS?.trim() ?? null
}

/** Dev seed hint: create BRL prices in Stripe Dashboard or via CLI; ids go in .env. */
export const BILLING_SEED_HINT = {
  proMonthlyBrl: 4_900,
  proYearlyBrl: 39_00,
  executiveMonthlyBrl: 12_900,
  executiveYearlyBrl: 99_00,
  searchPassBrl: 29_900,
  trialDays: 7,
} as const
