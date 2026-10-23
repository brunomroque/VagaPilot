import { loadPermissionsView } from "@/lib/permissions/server"
import { getUserContext } from "@/lib/server/context"

import { PermissionsClient } from "./permissions-client"

export const dynamic = "force-dynamic"

/** Configurações → Permissões do agente: modes, site allow/deny list, activity, notifications. */
export default async function PermissionsPage() {
  const session = await getUserContext()
  if (!session.ok) return <p className="text-sm">Entre para ver esta página.</p>
  const view = await loadPermissionsView(session.ctx.user.id)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">Permissões do agente</h2>
        <p className="text-sm text-muted-foreground">
          Escolha o que o agente pode fazer sem perguntar, como a lista de permissões do Cursor:
          por ação, por site (curingas como *.gupy.io) e por categoria de dados. Regras de negar
          sempre vencem. Sites de alto risco sempre perguntam. Você pode revogar tudo a qualquer
          momento.
        </p>
      </div>
      <PermissionsClient view={view} />
    </div>
  )
}
