"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  deleteSiteRiskLevelAction,
  upsertSiteRiskLevelAction,
} from "@/app/app/admin/risk-actions"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

type Level = "baixo" | "medio" | "alto"

export type LegalDocAdminRow = {
  slug: string
  title: string
  version: string
  sha256: string
  missingTags: string[]
  publishable: boolean
  acceptedUsers: number
}

/** Admin: automation-risk level per domain and the acknowledgement (document) versions. */
export function RiskLegalAdmin({
  levels,
  docs,
  draftAllowed,
}: {
  levels: { domain: string; level: Level; note: string | null }[]
  docs: LegalDocAdminRow[]
  draftAllowed: boolean
}) {
  const [busy, start] = useTransition()
  const [domain, setDomain] = useState("")
  const [level, setLevel] = useState<Level>("medio")
  const [note, setNote] = useState("")

  function save(d: string, l: Level, n: string | null) {
    start(async () => {
      const r = await upsertSiteRiskLevelAction({ domain: d, level: l, note: n })
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Salvo.")
        window.location.reload()
      }
    })
  }

  function remove(d: string) {
    start(async () => {
      const r = await deleteSiteRiskLevelAction({ domain: d })
      if (!r.ok) toast.error(r.error)
      else window.location.reload()
    })
  }

  const unfilled = docs.flatMap((d) => d.missingTags)
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <h3 className="font-semibold">Termos e versões de aceite</h3>
        {unfilled.length ? (
          <p role="alert" className="rounded border border-destructive/50 bg-destructive/5 p-2 text-xs">
            Há campos não preenchidos nos textos legais: {Array.from(new Set(unfilled)).join(", ")}.
            Preencha LEGAL_VARS (packages/core/src/legal.ts, ver docs/legal/TAGS.md).{" "}
            {draftAllowed
              ? "Rascunho permitido neste ambiente: os usuários podem aceitar a minuta."
              : "Em produção o aceite fica bloqueado até preencher (ou LEGAL_ALLOW_DRAFT=true)."}
          </p>
        ) : null}
        <table className="text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Documento</th>
              <th>Versão vigente</th>
              <th>SHA-256</th>
              <th>Usuários que aceitaram</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.slug}>
                <td>{d.title}</td>
                <td>{d.version}</td>
                <td className="font-mono">{d.sha256.slice(0, 16)}…</td>
                <td>{d.acceptedUsers}</td>
                <td>{d.publishable ? "publicável" : "bloqueado (tags)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          Os textos são imutáveis. Para uma nova versão: edite docs/legal/, crie nova migração com o
          novo registro e atualize LEGAL_CURRENT_VERSIONS — todos os usuários serão solicitados a
          aceitar de novo antes da próxima candidatura na nuvem.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <h3 className="font-semibold">Sites que restringem automação</h3>
        <p className="text-xs text-muted-foreground">
          Usado no selo das vagas e nos alertas da candidatura. O domínio mais específico vence.
        </p>
        <ul className="flex flex-col gap-1 text-xs">
          {levels.map((l) => (
            <li key={l.domain} className="flex flex-wrap items-center gap-2">
              <span className="w-48 font-mono">{l.domain}</span>
              <select
                value={l.level}
                disabled={busy}
                onChange={(e) => save(l.domain, e.target.value as Level, l.note)}
                className="rounded border bg-background px-1"
              >
                <option value="baixo">baixo</option>
                <option value="medio">médio</option>
                <option value="alto">alto</option>
              </select>
              <span className="text-muted-foreground">{l.note}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(l.domain)}>
                Remover
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            placeholder="dominio.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-48"
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            className="h-9 rounded border bg-background px-1 text-xs"
          >
            <option value="baixo">baixo</option>
            <option value="medio">médio</option>
            <option value="alto">alto</option>
          </select>
          <Input
            placeholder="Nota (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-64"
          />
          <Button size="sm" disabled={busy || !domain.trim()} onClick={() => save(domain, level, note.trim() || null)}>
            Adicionar
          </Button>
        </div>
      </section>
    </div>
  )
}
