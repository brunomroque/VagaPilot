"use client"

import { useState } from "react"

import { ORIGIN_LABELS, correctionHint, type SensitiveReport } from "@vagapilot/core/sensitive-report"

/** "Dados sensíveis enviados": what was answered in notable categories, and by whose authority. */
export function SensitiveReportView({ report, title }: { report: SensitiveReport; title: string }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!report.entries.length) return null
  return (
    <section aria-label={title} className="flex flex-col gap-1 rounded border border-red-500/50 p-2 text-xs">
      <p className="font-semibold">{title}</p>
      <ul className="flex flex-col gap-1">
        {report.entries.map((e, i) => (
          <li key={`${e.question}-${i}`} className="flex flex-col">
            <span>
              <strong>{e.categoryLabel}</strong>
              {e.sensitive ? " · sensível (LGPD art. 11)" : ""} · “{e.question}” → “{e.answer}”
            </span>
            <span className="text-muted-foreground">
              Origem: {ORIGIN_LABELS[e.origin]}
              {e.confidence !== null ? ` · confiança da IA ${Math.round(e.confidence * 100)}%` : ""} ·{" "}
              <button type="button" className="underline" onClick={() => setOpen(open === i ? null : i)}>
                Corrigir/contestar
              </button>
            </span>
            {open === i ? <span>{correctionHint(report.site)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
