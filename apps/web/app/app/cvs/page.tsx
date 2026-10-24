import Link from "next/link"
import { FileUpIcon, ListChecksIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import { CvLibrary } from "@/components/cvs/cv-library"
import { CvUpload } from "@/components/cvs/cv-upload"
import { loadCvLibrary } from "@/lib/cvs/server"
import { loadFactCounts } from "@/lib/facts/server"
import { PendingStartDates } from "@/components/profile/pending-start-dates"
import { getUserContext } from "@/lib/server/context"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default async function ResumesPage() {
  const t = await getTranslations("Cvs")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />

  const [library, factCounts] = await Promise.all([
    loadCvLibrary(context.ctx),
    loadFactCounts(context.ctx),
  ])
  const pendingFacts = factCounts.proposto

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {pendingFacts > 0 ? (
          <Link
            href="/app/fatos"
            className={buttonVariants({ variant: "outline" })}
          >
            <ListChecksIcon data-icon="inline-start" />
            {t("reviewFacts", { count: pendingFacts })}
          </Link>
        ) : null}
      </div>

      <PendingStartDates ctx={context.ctx} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 className="text-base font-bold">{t("upload.title")}</h3>
          </CardTitle>
          <CardDescription>{t("upload.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CvUpload tracks={library.tracks} />
        </CardContent>
      </Card>

      {library.versions.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileUpIcon />
            </EmptyMedia>
            <EmptyTitle>{t("empty.title")}</EmptyTitle>
            <EmptyDescription>{t("empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <CvLibrary tracks={library.tracks} versions={library.versions} />
    </section>
  )
}
