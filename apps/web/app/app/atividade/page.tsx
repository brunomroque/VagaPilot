import { getTranslations } from "next-intl/server"

import { getUserContext } from "@/lib/server/context"

export default async function ActivityPage() {
  const t = await getTranslations("Activity")
  const session = await getUserContext()
  if (!session.ok) {
    return <p className="p-6 text-muted-foreground">{t("signIn")}</p>
  }

  const { data } = await session.ctx.supabase
    .from("audit_log")
    .select("action, target_type, created_at, details")
    .eq("user_id", session.ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(100)

  const rows = (data ?? []) as {
    action: string
    target_type: string | null
    created_at: string
    details: Record<string, unknown> | null
  }[]

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.length === 0 ? (
          <li className="p-4 text-sm text-muted-foreground">{t("empty")}</li>
        ) : (
          rows.map((row) => (
            <li
              key={`${row.action}-${row.created_at}`}
              className="flex flex-col gap-1 p-4 text-sm"
            >
              <span className="font-medium">{row.action}</span>
              <span className="text-muted-foreground">
                {new Date(row.created_at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
                {row.target_type ? ` · ${row.target_type}` : ""}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
