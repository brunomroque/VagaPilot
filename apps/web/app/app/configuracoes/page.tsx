import { getTranslations } from "next-intl/server"

import { isPoolEnabled } from "@vagapilot/browser-pool"

import { ConnectedSites } from "@/components/settings/connected-sites"
import { ExtensionIntegration } from "@/components/settings/extension-integration"
import { listConnectedSites } from "@/lib/auth-sites/server"
import { GmailIntegration } from "@/components/settings/gmail-integration"
import { countReviewItems, getGmailConnection } from "@/lib/gmail/queries"
import { getGmailMode } from "@/lib/gmail/runtime"
import { getUserContext } from "@/lib/server/context"

/** Configurações → Integrações (P4.1). Reads run under the user's RLS session. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("Settings")
  const params = await searchParams
  const session = await getUserContext()
  const [connection, reviewCount, connectedSites] = session.ok
    ? await Promise.all([
        getGmailConnection(session.ctx.supabase),
        countReviewItems(session.ctx.supabase),
        listConnectedSites(session.ctx.user.id),
      ])
    : [null, 0, []]
  const flash = {
    gmail: typeof params.gmail === "string" ? params.gmail : undefined,
    motivo: typeof params.motivo === "string" ? params.motivo : undefined,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <section
        aria-labelledby="integrations-title"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h3
            id="integrations-title"
            className="text-lg font-bold tracking-tight"
          >
            {t("integrations")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("integrationsDescription")}
          </p>
        </div>
        <GmailIntegration
          mode={getGmailMode()}
          connection={connection}
          reviewCount={reviewCount}
          flash={flash}
          isDev={process.env.NODE_ENV !== "production"}
        />
        <ExtensionIntegration />
        <ConnectedSites
          initial={connectedSites}
          poolEnabled={isPoolEnabled()}
        />
      </section>
      <section aria-labelledby="risks-title" className="flex flex-col gap-1 rounded-md border p-4">
        <h3 id="risks-title" className="text-lg font-bold tracking-tight">
          Riscos e responsabilidades
        </h3>
        <p className="text-sm text-muted-foreground">
          O que pode dar errado quando a automação age em seu nome, os termos que você aceitou, os
          comprovantes do aceite e a revogação.
        </p>
        <div>
          <a href="/app/configuracoes/riscos" className="text-sm font-medium underline">
            Ver riscos e termos
          </a>
        </div>
      </section>
      <section aria-labelledby="perms-title" className="flex flex-col gap-1 rounded-md border p-4">
        <h3 id="perms-title" className="text-lg font-bold tracking-tight">
          Permissões do agente
        </h3>
        <p className="text-sm text-muted-foreground">
          O que o agente pode fazer sem perguntar, em quais sites e com quais dados.
        </p>
        <div>
          <a href="/app/configuracoes/permissoes" className="text-sm font-medium underline">
            Gerenciar permissões
          </a>
        </div>
      </section>
      <p className="text-sm text-muted-foreground">{t("more")}</p>
    </div>
  )
}
