"use client"

import { useState, useTransition } from "react"
import { KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import {
  deleteConnectedSiteAction,
  listConnectedSitesAction,
} from "@/app/app/configuracoes/sites-actions"
import type { ConnectedSite } from "@/lib/auth-sites/server"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"

import { SiteLoginCard } from "./site-login-card"

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—"

/** Configurações → Sites conectados: saved cloud logins (ATS), with expiry and delete. */
export function ConnectedSites({
  initial,
  poolEnabled,
}: {
  initial: ConnectedSite[]
  poolEnabled: boolean
}) {
  const [sites, setSites] = useState(initial)
  const [url, setUrl] = useState("")
  const [connecting, setConnecting] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  function reload() {
    startTransition(async () => {
      const result = await listConnectedSitesAction()
      if (result.ok) setSites(result.data)
    })
  }

  function remove(site: ConnectedSite) {
    startTransition(async () => {
      const result = await deleteConnectedSiteAction({
        site: site.site,
        provider: site.provider,
      })
      if (!result.ok || !result.data.deleted)
        toast.error("Não consegui remover.")
      const list = await listConnectedSitesAction()
      if (list.ok) setSites(list.data)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" aria-hidden />
          Sites conectados
        </CardTitle>
        <CardDescription>
          Logins salvos para o navegador na nuvem se candidatar por você (Gupy,
          InHire, SuccessFactors, Cornerstone, SmartRecruiters…). A senha nunca
          passa pelo VagaPilot.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sites.length ? (
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {sites.map((s) => (
              <li
                key={`${s.site}-${s.provider}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div className="flex flex-col">
                  <strong>{s.site}</strong>
                  <span className="text-xs text-muted-foreground">
                    {s.status === "active" ? "Ativo" : "Expirado"} · expira{" "}
                    {fmt(s.expiresAt)} · via {s.provider}
                    {s.native ? " (perfil salvo no provedor)" : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  {s.status !== "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConnecting(`https://${s.site}`)}
                      disabled={busy}
                    >
                      Reconectar
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(s)}
                    disabled={busy}
                  >
                    Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum site conectado ainda.
          </p>
        )}
        {!poolEnabled ? (
          <p className="text-xs text-muted-foreground">
            O navegador na nuvem está desligado neste ambiente.
          </p>
        ) : connecting ? (
          <SiteLoginCard
            key={connecting}
            url={connecting}
            autoStart
            onDone={(status) => {
              if (status === "saved") {
                toast.success("Site conectado.")
                setConnecting(null)
              }
              reload()
            }}
          />
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (url.trim()) setConnecting(url.trim())
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Página de login, ex.: https://empresa.gupy.io/candidates/signin"
              aria-label="Endereço da página de login"
            />
            <Button type="submit" size="sm" disabled={!url.trim()}>
              Conectar site
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
