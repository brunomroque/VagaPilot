"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

type Interval = "month" | "year"

type PlanCardModel = {
  id: "free" | "pro" | "executive" | "search_pass"
  name: string
  priceMonth: string
  priceYear: string | null
  features: string[]
  purchasable: boolean
}

export function PlanCards({
  plans,
  notice,
}: {
  plans: PlanCardModel[]
  notice: string | null
}) {
  const t = useTranslations("Billing")
  const [interval, setInterval] = useState<Interval>("month")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function checkout(plan: PlanCardModel["id"]) {
    setError(null)
    startTransition(async () => {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval: plan === "search_pass" ? undefined : interval,
        }),
      }).catch(() => null)
      const payload = (await response?.json().catch(() => null)) as {
        url?: string
        error?: { message?: string }
      } | null
      if (!response?.ok || !payload?.url) {
        setError(payload?.error?.message ?? t("errors.checkoutFailed"))
        return
      }
      window.location.assign(payload.url)
    })
  }

  function portal() {
    setError(null)
    startTransition(async () => {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      }).catch(() => null)
      const payload = (await response?.json().catch(() => null)) as {
        url?: string
        error?: { message?: string }
      } | null
      if (!response?.ok || !payload?.url) {
        setError(payload?.error?.message ?? t("errors.checkoutFailed"))
        return
      }
      window.location.assign(payload.url)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant={interval === "month" ? "default" : "outline"}
          onClick={() => setInterval("month")}
        >
          {t("interval.month")}
        </Button>
        <Button
          type="button"
          variant={interval === "year" ? "default" : "outline"}
          onClick={() => setInterval("year")}
        >
          {t("interval.year")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={portal}
          disabled={pending}
        >
          {t("manage")}
        </Button>
      </div>
      {notice ? (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-center text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const price =
            plan.id !== "search_pass" && interval === "year" && plan.priceYear
              ? plan.priceYear
              : plan.priceMonth
          return (
            <Card
              key={plan.id}
              className={plan.id === "pro" ? "border-primary" : undefined}
            >
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{price}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {plan.features.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {plan.purchasable ? (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={pending}
                    onClick={() => checkout(plan.id)}
                  >
                    {t("subscribe")}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("freeNote")}
                  </p>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
