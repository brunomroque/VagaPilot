import { redirect } from "next/navigation"

import {
  DOC_ACCEPT_CLAUSES,
  SIGNUP_REQUIRED_LEGAL_DOCS,
  documentsNeedingAcceptance,
} from "@vagapilot/core/legal"

import { AceiteLegalPanel } from "@/components/auth/aceite-legal-panel"
import { getCurrentUser, hasAcceptedTerms } from "@/lib/auth/session"
import {
  latestByDocument,
  loadCurrentLegalDocuments,
  loadEvidence,
} from "@/lib/legal/server"
import { safeNextPath } from "@/lib/url"

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/entrar?next=/aceite")

  const next = safeNextPath((await searchParams).next, "/app/onboarding")
  if (await hasAcceptedTerms(user)) redirect(next)

  const [loaded, evidence] = await Promise.all([
    loadCurrentLegalDocuments(),
    loadEvidence(user.id),
  ])
  const { docs, error: documentsLoadError } = loaded
  const latest = latestByDocument(evidence)
  const current = Object.fromEntries(
    SIGNUP_REQUIRED_LEGAL_DOCS.filter((s) => docs[s]).map((s) => [
      s,
      { version: docs[s]!.version, sha256: docs[s]!.sha256 },
    ])
  )
  const pending = documentsNeedingAcceptance(
    latest,
    current,
    SIGNUP_REQUIRED_LEGAL_DOCS
  )

  return (
    <AceiteLegalPanel
      next={next}
      pending={pending}
      documentsLoadFailed={Boolean(documentsLoadError)}
      docs={SIGNUP_REQUIRED_LEGAL_DOCS.flatMap((slug) => {
        const doc = docs[slug]
        if (!doc) return []
        const last = latest[slug]
        return [
          {
            slug,
            title: doc.title,
            version: doc.version,
            sha256: doc.sha256,
            text: doc.text,
            publishable: doc.publishable,
            clauses: [...DOC_ACCEPT_CLAUSES[slug]],
            accepted:
              last?.action === "accept" &&
              last.document_version === doc.version &&
              last.document_sha256 === doc.sha256,
            previousVersion:
              last && last.document_version !== doc.version
                ? last.document_version
                : null,
          },
        ]
      })}
    />
  )
}
