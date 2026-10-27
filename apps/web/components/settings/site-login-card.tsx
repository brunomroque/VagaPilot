"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  finishSiteLoginAction,
  loadSiteLoginAction,
  startSiteLoginAction,
} from "@/app/app/configuracoes/sites-actions"
import type { SiteLoginView } from "@/lib/auth-sites/server"
import { Button } from "@workspace/ui/components/button"

const POLL_MS = 3000
const FINAL = ["saved", "cancelled", "expired", "failed"]
const LABEL: Record<string, string> = {
  starting: "Abrindo navegador (local ou nuvem)…",
  opening: "Abrindo a página de login…",
  waiting_user: "Faça o login para continuar",
  confirm_requested: "Salvando a sessão…",
  saved: "Site conectado",
  cancelled: "Login cancelado",
  expired: "Tempo esgotado",
  failed: "Não deu certo",
}

/**
 * "Conectar site": opens the site's login page in a cloud browser and shows its live view. The
 * user types password/2FA in the remote browser (the app never sees them) and taps "Pronto".
 */
export function SiteLoginCard({
  url,
  applyRunId,
  autoStart = false,
  onDone,
}: {
  url: string
  applyRunId?: string | null
  autoStart?: boolean
  onDone?: (status: string) => void
}) {
  const [loginId, setLoginId] = useState<string | null>(null)
  const [view, setView] = useState<SiteLoginView | null>(null)
  const [busy, startTransition] = useTransition()

  const start = useCallback(() => {
    startTransition(async () => {
      const result = await startSiteLoginAction({
        url,
        applyRunId: applyRunId ?? null,
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      setView(null)
      setLoginId(result.data.loginId)
    })
  }, [url, applyRunId])

  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || autoStarted.current) return
    autoStarted.current = true
    start()
  }, [autoStart, start])

  useEffect(() => {
    if (!loginId) return
    let stopped = false
    const tick = async () => {
      const result = await loadSiteLoginAction({ loginId })
      if (stopped || !result.ok) return
      setView(result.data)
      if (FINAL.includes(result.data.status)) {
        stopped = true
        onDone?.(result.data.status)
      }
    }
    void tick()
    const id = window.setInterval(() => {
      if (!stopped) void tick()
    }, POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [loginId, onDone])

  function finish(action: "confirm" | "cancel") {
    if (!loginId) return
    startTransition(async () => {
      const result = await finishSiteLoginAction({ loginId, action })
      if (!result.ok || !result.data.updated)
        toast.error("Não consegui atualizar o login.")
    })
  }

  if (!loginId) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <p className="text-muted-foreground">
          Conecte sua conta neste site uma vez. Você digita a senha e o código
          2FA direto no seu Chrome local (ou no navegador na nuvem, se o local
          não estiver ativo); o VagaPilot só guarda a sessão, criptografada.
        </p>
        <p className="rounded border border-amber-500/50 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          <strong>Aviso de risco:</strong> usamos o seu próprio navegador como
          provedor primário (e Browserbase na nuvem só como fallback) para
          reduzir bloqueios de datacenter, mas sites como LinkedIn, Gupy e
          outros ainda podem limitar ou bloquear contas que usam automação. Ao
          conectar, <strong>você assume integralmente esse risco</strong>.{" "}
          <a
            href="/app/configuracoes/riscos#navegador_local"
            className="underline"
          >
            Saiba mais
          </a>
          .
        </p>
        <div>
          <Button size="sm" onClick={start} disabled={busy}>
            Conectar site
          </Button>
        </div>
      </div>
    )
  }

  const status = view?.status ?? "starting"
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3 text-sm"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <strong>
          {LABEL[status] ?? status}
          {view?.site ? ` · ${view.site}` : ""}
        </strong>
        {!FINAL.includes(status) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => finish("cancel")}
            disabled={busy}
          >
            Cancelar
          </Button>
        ) : null}
      </div>
      {view?.lastError ? (
        <p className="text-xs text-destructive">{view.lastError}</p>
      ) : null}
      {view?.liveViewUrl ? (
        <>
          <a
            href={view.liveViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Abrir em tela cheia (melhor no celular)
          </a>
          <iframe
            src={view.liveViewUrl}
            title="Login no navegador na nuvem"
            className="h-[460px] w-full rounded border"
            sandbox="allow-same-origin allow-scripts allow-forms allow-pointer-lock"
          />
        </>
      ) : status === "waiting_user" ? (
        <p className="text-xs text-muted-foreground">
          Abrimos a página de login no <strong>seu Chrome local</strong>. Faça o
          login diretamente nele e depois clique no botão abaixo.
        </p>
      ) : null}
      {view?.liveViewUrl || status === "waiting_user" ? (
        <div>
          <Button
            size="sm"
            onClick={() => finish("confirm")}
            disabled={busy || status !== "waiting_user"}
          >
            Pronto, já entrei
          </Button>
        </div>
      ) : null}
      {FINAL.includes(status) && status !== "saved" ? (
        <div>
          <Button size="sm" variant="outline" onClick={start} disabled={busy}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
    </div>
  )
}
