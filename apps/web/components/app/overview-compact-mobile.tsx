"use client"

import { useTranslations } from "next-intl"

import { OverviewCompact } from "@/components/app/overview-compact"

/** Collapsible summary metrics on small viewports (UX08). */
export function OverviewCompactMobile() {
  const t = useTranslations("AppHome.panel")

  return (
    <details className="group rounded-xl border bg-card lg:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {t("mobileToggle")}
        <span
          className="text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div className="border-t px-1 pb-1">
        <OverviewCompact />
      </div>
    </details>
  )
}
