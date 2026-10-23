import Link from "next/link"

import type { LegalSlug } from "@vagapilot/core/legal"

import { LegalDraft } from "@/components/legal-draft"
import { LegalText } from "@/components/risk/legal-text"
import { loadCurrentLegalDocuments } from "@/lib/legal/server"

/** Public page of the current version of a legal document (same rendered text that is hashed). */
export async function PublicLegalPage({
  slug,
  fallback,
}: {
  slug: LegalSlug
  fallback: "termsTitle" | "privacyTitle"
}) {
  const docs = await loadCurrentLegalDocuments().catch(
    (): Awaited<ReturnType<typeof loadCurrentLegalDocuments>> => ({})
  )
  const doc = docs[slug]
  if (!doc) return <LegalDraft title={fallback} />
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-6 text-sm">
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <p className="text-xs text-muted-foreground">
        Versão {doc.version} · vigente desde {doc.effectiveDate} · SHA-256 {doc.sha256}
      </p>
      <div className="leading-relaxed whitespace-pre-wrap">
        <LegalText text={doc.text} />
      </div>
      <nav className="flex gap-4 border-t pt-3 text-xs">
        <Link href="/termos" className="underline">Termos de Uso</Link>
        <Link href="/privacidade" className="underline">Privacidade</Link>
        <Link href="/riscos" className="underline">Riscos da automação</Link>
      </nav>
    </main>
  )
}
