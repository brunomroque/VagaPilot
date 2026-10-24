"use client"

import Link from "next/link"
import { CheckIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import type { CvProfileDiffItem } from "@vagapilot/jobs"

import { useActionRunner } from "@/components/forms/fields"
import { applyCvDiffItem, dismissCvDiffItem } from "@/app/app/cvs/actions"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"

function describe(item: CvProfileDiffItem): string {
  switch (item.kind) {
    case "experience": {
      const e = item.value
      const end = e.isCurrent ? "atual" : (e.endMonth ?? "?")
      return `${e.title} · ${e.company}${e.startMonth ? ` (${e.startMonth} – ${end})` : ""}`
    }
    case "education":
      return [item.value.degree, item.value.field, item.value.institution]
        .filter(Boolean)
        .join(" · ")
    case "language":
      return `${item.value.language} (${item.value.level})`
    case "certification":
      return item.value.issuer
        ? `${item.value.name} · ${item.value.issuer}`
        : item.value.name
    case "skill":
      return item.value.name
  }
}

const VISIBLE = 8

/** Approval cards: CV data missing from the profile. Nothing is applied without a click. */
export function CvProfileDiff({
  versionId,
  items,
}: {
  versionId: string
  items: CvProfileDiffItem[]
}) {
  const t = useTranslations("Cvs.diff")
  const { pending, run } = useActionRunner()
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2" data-testid={`cv-diff-${versionId}`}>
      <Separator />
      <span className="text-xs font-semibold text-muted-foreground">
        {t("title", { count: items.length })}
      </span>
      <ul className="flex flex-col gap-1 text-sm">
        {items.slice(0, VISIBLE).map((item) => {
          const needsDetails =
            item.kind === "experience" && !item.value.startMonth
          return (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0 break-words">
                <span className="text-muted-foreground">
                  {t(`kinds.${item.kind}`)}:{" "}
                </span>
                {describe(item)}
              </span>
              <span className="flex gap-1">
                {needsDetails ? (
                  <Link
                    href="/app/perfil"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    {t("complete")}
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => applyCvDiffItem({ versionId, key: item.key }), {
                        success: t("applied"),
                      })
                    }
                  >
                    <CheckIcon data-icon="inline-start" />
                    {t("apply")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={t("dismiss")}
                  onClick={() =>
                    run(() => dismissCvDiffItem({ versionId, key: item.key }), {
                      success: t("dismissed"),
                    })
                  }
                >
                  <XIcon />
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
      {items.length > VISIBLE ? (
        <span className="text-xs text-muted-foreground">
          {t("more", { count: items.length - VISIBLE })}
        </span>
      ) : null}
    </div>
  )
}
