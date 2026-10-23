"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  listRecipesAction,
  setRecipeStatusAction,
  type RecipeRow,
} from "@/app/app/admin/actions"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

const STATUS: Record<string, string> = {
  learning: "Aprendendo",
  trusted: "Confiável",
  stale: "Desatualizada",
  relearning: "Reaprendendo",
  disabled: "Desativada",
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "nunca"
}

/** Receitas aprendidas de ATS desconhecidos: status, validação, drift e desativação. */
export function AtsRecipesAdmin() {
  const [rows, setRows] = useState<RecipeRow[] | null>(null)
  const [pending, start] = useTransition()

  const load = () =>
    start(async () => {
      const result = await listRecipesAction()
      if (result.ok) setRows(result.data)
      else toast.error(result.error)
    })
  useEffect(load, [])

  const setStatus = (id: string, status: "disabled" | "learning" | "stale") =>
    start(async () => {
      const result = await setRecipeStatusAction({ id, status })
      if (!result.ok) return void toast.error(result.error)
      toast.success("Receita atualizada.")
      const fresh = await listRecipesAction()
      if (fresh.ok) setRows(fresh.data)
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receitas de ATS aprendidas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Passos que a IA aprendeu em sites desconhecidos. São repetidos sem IA
          enquanto a página não muda; com mudança grande a receita fica
          desatualizada e a IA reaprende (a versão antiga fica guardada).
          Nenhuma resposta pessoal ou senha é salva aqui.
        </p>
        {rows === null ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma receita ainda.</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-1 rounded-md border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.domain}</span>
                <span className="text-muted-foreground">v{r.version}</span>
                <Badge
                  variant={r.status === "trusted" ? "default" : "secondary"}
                >
                  {STATUS[r.status] ?? r.status}
                </Badge>
                <span className="text-muted-foreground">
                  {r.steps} passos · {r.successes} sucessos · {r.failures}{" "}
                  falhas · validada {date(r.last_validated_at)}
                </span>
              </div>
              {r.drift_history.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Drift recente:{" "}
                  {r.drift_history
                    .map(
                      (d) =>
                        `passo ${d.step + 1}: ${d.score.toFixed(2)} (${d.level})`
                    )
                    .join(" · ")}
                </p>
              )}
              <div className="flex gap-2">
                {r.status === "disabled" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setStatus(r.id, "learning")}
                  >
                    Reativar
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setStatus(r.id, "disabled")}
                    >
                      Desativar
                    </Button>
                    {r.status !== "stale" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setStatus(r.id, "stale")}
                      >
                        Forçar reaprendizado
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
