import Link from "next/link"
import { CalendarClockIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import type { UserContext } from "@/lib/server/context"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { buttonVariants } from "@workspace/ui/components/button"

/**
 * Pending item for experiences saved without a start date (CV without dates). Stays visible
 * on the profile, facts and CV pages until every experience has a start month.
 */
export async function PendingStartDates({ ctx }: { ctx: UserContext }) {
  const { data, error } = await ctx.supabase
    .from("experiences")
    .select("id, company, title")
    .eq("user_id", ctx.user.id)
    .is("start_date", null)
  if (error || !data || data.length === 0) return null
  const t = await getTranslations("PendingStartDates")
  const rows = data as { id: string; company: string; title: string }[]
  return (
    <Alert>
      <CalendarClockIcon />
      <AlertTitle>{t("title", { count: rows.length })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{t("description")}</span>
        <ul className="list-disc pl-4">
          {rows.map((row) => (
            <li key={row.id}>
              {row.title} · {row.company}
            </li>
          ))}
        </ul>
        <Link
          href="/app/perfil?secao=trajetoria"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t("action")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
