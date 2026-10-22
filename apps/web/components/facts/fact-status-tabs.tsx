import Link from "next/link"
import { getTranslations } from "next-intl/server"

import type { FactStatus } from "@vagapilot/core/facts"
import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"

/** Status filter as links (server-rendered, keeps `?status=` shareable). */
export async function FactStatusTabs({
  basePath,
  current,
  counts,
}: {
  basePath: string
  current: FactStatus
  counts: Record<FactStatus, number>
}) {
  const t = await getTranslations("Facts.status")
  const statuses: FactStatus[] = ["proposto", "confirmado", "rejeitado"]
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {statuses.map((status) => (
        <Link
          key={status}
          href={`${basePath}?status=${status}`}
          aria-current={status === current ? "page" : undefined}
          className={buttonVariants({
            variant: status === current ? "secondary" : "ghost",
            size: "sm",
          })}
        >
          {t(status)}
          <Badge variant={status === current ? "default" : "outline"}>
            {counts[status]}
          </Badge>
        </Link>
      ))}
    </nav>
  )
}
