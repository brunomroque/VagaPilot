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
      <p className="text-sm text-muted-foreground">{t("more")}</p>
    </div>
  )
}
