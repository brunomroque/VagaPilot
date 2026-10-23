import { notFound } from "next/navigation"

import { NotConfigured } from "@/components/app/not-configured"
import { AtsRecipesAdmin } from "@/components/admin/ats-recipes-admin"
import { BrowserPoolAdmin } from "@/components/admin/browser-pool-admin"
import { RiskLegalAdmin } from "@/components/admin/risk-legal-admin"
import { isAppAdmin, loadAdminDashboard } from "@/lib/admin/server"
import {
  countCurrentAcceptances,
  legalDraftAllowed,
  loadCurrentLegalDocuments,
  loadSiteRiskLevels,
} from "@/lib/legal/server"
import { getUserContext } from "@/lib/server/context"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title="Administração" />
  if (!(await isAppAdmin(context.ctx.supabase))) notFound()
  const [dashboard, levels, docs] = await Promise.all([
    loadAdminDashboard(context.ctx),
    loadSiteRiskLevels(),
    loadCurrentLegalDocuments(),
  ])
  const docRows = await Promise.all(
    Object.values(docs).map(async (d) => ({
      slug: d!.slug,
      title: d!.title,
      version: d!.version,
      sha256: d!.sha256,
      missingTags: d!.missingTags,
      publishable: d!.publishable,
      acceptedUsers: await countCurrentAcceptances(d!.slug, d!.version),
    }))
  )
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">
          Administração · Navegadores na nuvem
        </h2>
        <p className="text-sm text-muted-foreground">
          Provedores, cotas gratuitas e sessões. As chaves ficam só nas
          variáveis de ambiente; aqui guardamos apenas o nome da variável.
        </p>
      </div>
      <BrowserPoolAdmin dashboard={dashboard} />
      <AtsRecipesAdmin />
      <RiskLegalAdmin levels={levels} docs={docRows} draftAllowed={legalDraftAllowed()} />
    </section>
  )
}
