"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import { LegalAcceptanceCard } from "@/components/risk/legal-acceptance-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

type DocPanel = {
  slug: string
  title: string
  version: string
  sha256: string
  text: string
  publishable: boolean
  clauses: { id: string; label: string }[]
  accepted: boolean
  previousVersion: string | null
}

export function AceiteLegalPanel({
  pending,
  docs,
}: {
  next: string
  pending: string[]
  docs: DocPanel[]
}) {
  const t = useTranslations("Consent")

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-bold">{t("title")}</h1>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          {pending.length > 0 ? (
            <p>{t("legalPending", { count: pending.length })}</p>
          ) : (
            <p>{t("legalComplete")}</p>
          )}
          <p>
            <Link
              href="/termos"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              {t("termsLink")}
            </Link>
            {" · "}
            <Link
              href="/privacidade"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              {t("privacyLink")}
            </Link>
          </p>
        </CardContent>
      </Card>

      {docs.map((doc) => (
        <div key={doc.slug} className="flex flex-col gap-1">
          {doc.previousVersion ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t("legalVersionChanged", {
                from: doc.previousVersion,
                to: doc.version,
              })}
            </p>
          ) : null}
          <LegalAcceptanceCard
            doc={{
              slug: doc.slug,
              title: doc.title,
              version: doc.version,
              sha256: doc.sha256,
              text: doc.text,
              publishable: doc.publishable,
            }}
            clauses={doc.clauses}
            accepted={doc.accepted}
            gmailSend={false}
            history={[]}
            compact
          />
        </div>
      ))}
    </div>
  )
}
