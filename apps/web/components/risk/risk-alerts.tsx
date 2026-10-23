import Link from "next/link"

import type { RiskAlert } from "@vagapilot/core/risks"

const TONE: Record<string, string> = {
  alto: "border-destructive/50 bg-destructive/5",
  atencao: "border-amber-500/50 bg-amber-500/5",
  info: "border-border bg-muted/40",
}

/** Contextual risk alerts of the journey (site, account, terms, AI, recipe, review). */
export function RiskAlertList({ alerts }: { alerts: readonly RiskAlert[] }) {
  if (!alerts.length) return null
  return (
    <ul className="flex flex-col gap-1" aria-label="Alertas de risco">
      {alerts.map((a) => (
        <li
          key={a.id}
          role="alert"
          className={`rounded border px-2 py-1 text-xs ${TONE[a.severity] ?? TONE.info}`}
        >
          <strong>⚠ {a.title}.</strong> {a.detail ?? a.short}{" "}
          <Link href={`/app/configuracoes/riscos#${a.id}`} className="underline">
            Saiba mais
          </Link>
        </li>
      ))}
    </ul>
  )
}

const BADGE: Record<string, { label: string; cls: string }> = {
  alto: { label: "Site restringe robôs", cls: "border-destructive/50 text-destructive" },
  medio: { label: "Site pode restringir robôs", cls: "border-amber-500/60 text-amber-700 dark:text-amber-400" },
}

/** Badge for jobs on domains the admin marked as risky for automation. */
export function SiteRiskBadge({ level }: { level: string | null | undefined }) {
  const badge = level ? BADGE[level] : undefined
  if (!badge) return null
  return (
    <span
      title="Este site pode bloquear ou suspender contas que usam automação. Veja Riscos e responsabilidades."
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
    >
      ⚠ {badge.label}
    </span>
  )
}
