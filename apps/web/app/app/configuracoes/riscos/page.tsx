import { GMAIL_SEND_SCOPE } from "@vagapilot/gmail"
import { CLOUD_APPLY_REQUIRED_DOCS, DOC_ACCEPT_CLAUSES } from "@vagapilot/core/legal"
import { RISK_CATALOG } from "@vagapilot/core/risks"

import { LegalAcceptanceCard } from "@/components/risk/legal-acceptance-card"
import { getGmailRuntime } from "@/lib/gmail/runtime"
import {
  cloudApplyConsent,
  latestByDocument,
  loadCurrentLegalDocuments,
  loadEvidence,
} from "@/lib/legal/server"
import { getUserContext } from "@/lib/server/context"

export const dynamic = "force-dynamic"

/** Configurações → Riscos e responsabilidades: risk catalog, clickwrap, evidence, revocation. */
export default async function RisksPage() {
  const session = await getUserContext()
  if (!session.ok) return <p className="text-sm">Entre para ver esta página.</p>
  const userId = session.ctx.user.id
  const runtime = getGmailRuntime()
  const [docs, evidence, consent, connection] = await Promise.all([
    loadCurrentLegalDocuments(),
    loadEvidence(userId),
    cloudApplyConsent(userId),
    runtime ? runtime.store.getConnection(userId).catch(() => null) : Promise.resolve(null),
  ])
  const latest = latestByDocument(evidence)
  const gmailSend = Boolean(connection?.scopes.includes(GMAIL_SEND_SCOPE))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">Riscos e responsabilidades</h2>
        <p className="text-sm text-muted-foreground">
          O VagaPilot ajuda você a se candidatar, mas age em sites de terceiros em seu nome. Leia os
          riscos abaixo. A candidatura na nuvem só é liberada depois do aceite da versão vigente.
        </p>
        <p
          role="status"
          className={`text-sm font-medium ${consent.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
        >
          {consent.ok
            ? "Candidatura na nuvem liberada: você aceitou a versão vigente."
            : consent.revoked
              ? "Candidatura na nuvem desativada: você revogou o aceite."
              : "Candidatura na nuvem bloqueada até você aceitar os documentos abaixo."}
        </p>
      </div>

      <section aria-labelledby="catalog" className="flex flex-col gap-2">
        <h3 id="catalog" className="text-lg font-bold tracking-tight">Os riscos</h3>
        <ul className="flex flex-col gap-2">
          {RISK_CATALOG.map((r) => (
            <li key={r.id} id={r.id} className="rounded border p-3 text-sm">
              <p className="font-semibold">
                {r.severity === "alto" ? "⚠ " : ""}
                {r.title}
              </p>
              <p>{r.short}</p>
              <p className="text-xs text-muted-foreground">{r.more}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="docs" className="flex flex-col gap-3">
        <h3 id="docs" className="text-lg font-bold tracking-tight">Documentos e aceite</h3>
        {CLOUD_APPLY_REQUIRED_DOCS.map((slug) => {
          const doc = docs[slug]
          if (!doc) return null
          const last = latest[slug]
          return (
            <LegalAcceptanceCard
              key={slug}
              doc={{
                slug: doc.slug,
                title: doc.title,
                version: doc.version,
                sha256: doc.sha256,
                text: doc.text,
                publishable: doc.publishable,
              }}
              clauses={[...DOC_ACCEPT_CLAUSES[slug]]}
              accepted={
                last?.action === "accept" &&
                last.document_version === doc.version &&
                last.document_sha256 === doc.sha256
              }
              gmailSend={gmailSend}
              history={evidence
                .filter((e) => e.document_slug === slug)
                .map((e) => ({
                  id: e.id,
                  action: e.action,
                  version: e.document_version,
                  at: e.accepted_at,
                }))
                .reverse()}
            />
          )
        })}
      </section>
    </div>
  )
}
