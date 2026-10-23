"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  acceptLegalDocumentAction,
  revokeLegalAcceptanceAction,
  sendAcceptanceCopyAction,
} from "@/app/app/configuracoes/riscos/actions"
import { LegalText } from "@/components/risk/legal-text"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

type Doc = {
  slug: string
  title: string
  version: string
  sha256: string
  text: string
  publishable: boolean
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)"
}

/**
 * Clickwrap: full text with scroll-to-end, separate unchecked boxes, optional typed ACEITO/name,
 * "Li e aceito". Afterwards: JSON certificate, optional e-mail copy (only on click) and revocation.
 */
export function LegalAcceptanceCard({
  doc,
  clauses,
  accepted,
  gmailSend,
  history,
}: {
  doc: Doc
  clauses: { id: string; label: string }[]
  accepted: boolean
  gmailSend: boolean
  history: { id: string; action: string; version: string; at: string }[]
}) {
  const [scrolled, setScrolled] = useState(false)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [typed, setTyped] = useState("")
  const [via, setVia] = useState<"transacional" | "gmail">("transacional")
  const [busy, start] = useTransition()
  const [needsReauth, setNeedsReauth] = useState(false)
  const allChecked = clauses.every((c) => checks[c.id] === true)
  const lastAccept = history.find((h) => h.action === "accept")

  function accept() {
    start(async () => {
      const r = await acceptLegalDocumentAction({
        slug: doc.slug,
        version: doc.version,
        sha256: doc.sha256,
        checkboxes: Object.fromEntries(clauses.map((c) => [c.id, checks[c.id] === true])),
        typedConfirmation: typed.trim() || null,
        scrolledToEnd: scrolled,
      })
      if (!r.ok) {
        if (r.error === "reauth_required") setNeedsReauth(true)
        else toast.error(r.error)
        return
      }
      toast.success("Aceite registrado. Baixe o comprovante se quiser.")
      window.location.reload()
    })
  }

  function revoke() {
    if (!window.confirm("Revogar o aceite? A candidatura na nuvem será desativada e as em andamento canceladas."))
      return
    start(async () => {
      const r = await revokeLegalAcceptanceAction({ slug: doc.slug })
      if (!r.ok) toast.error(r.error)
      else {
        toast.success(`Aceite revogado. ${r.data.cancelledRuns} candidatura(s) cancelada(s).`)
        window.location.reload()
      }
    })
  }

  function sendCopy(recordId: string) {
    start(async () => {
      const r = await sendAcceptanceCopyAction({ recordId, via, approved: true })
      if (!r.ok) toast.error(r.error)
      else toast.success("Cópia enviada para o seu e-mail.")
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{doc.title}</strong>
        <span className="text-xs text-muted-foreground">
          versão {doc.version} · SHA-256 {doc.sha256.slice(0, 12)}…
        </span>
      </div>
      {!doc.publishable ? (
        <p role="alert" className="text-xs text-destructive">
          Versão ainda não publicada: há dados da empresa pendentes no texto.
        </p>
      ) : null}
      {accepted ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Você aceitou esta versão{lastAccept ? ` em ${fmt(lastAccept.at)}` : ""}.
        </p>
      ) : null}
      <div
        tabIndex={0}
        aria-label={`Texto completo: ${doc.title}`}
        className="max-h-72 overflow-y-auto rounded border bg-muted/30 p-2 text-xs leading-relaxed whitespace-pre-wrap"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setScrolled(true)
        }}
      >
        <LegalText text={doc.text} />
      </div>
      {!accepted ? (
        <>
          {!scrolled ? (
            <p className="text-xs text-muted-foreground">Role o texto até o fim para liberar o aceite.</p>
          ) : null}
          <fieldset disabled={!scrolled || busy || !doc.publishable} className="flex flex-col gap-1">
            <legend className="sr-only">Itens do aceite</legend>
            {clauses.map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checks[c.id] === true}
                  onChange={(e) => setChecks((v) => ({ ...v, [c.id]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>{c.label}</span>
              </label>
            ))}
            <label className="mt-1 flex flex-col gap-1 text-xs">
              Opcional: digite ACEITO ou seu nome completo
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={200} />
            </label>
            <div className="mt-1">
              <Button size="sm" onClick={accept} disabled={!scrolled || !allChecked || busy}>
                Li e aceito
              </Button>
            </div>
          </fieldset>
          {needsReauth ? (
            <p role="alert" className="text-xs">
              Por segurança, o aceite exige um login recente (últimos 5 minutos).{" "}
              <a href="/entrar?next=/app/configuracoes/riscos" className="underline">
                Entrar de novo
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      {history.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer">Comprovantes ({history.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {h.action === "accept" ? "Aceite" : "Revogação"} v{h.version} · {fmt(h.at)}
                </span>
                <a href={`/api/legal/certificate/${h.id}`} className="underline">
                  Baixar (JSON)
                </a>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => sendCopy(h.id)}>
                  Enviar cópia por e-mail
                </Button>
              </li>
            ))}
          </ul>
          <label className="mt-1 flex items-center gap-2">
            Enviar por
            <select
              value={via}
              onChange={(e) => setVia(e.target.value as "transacional" | "gmail")}
              className="rounded border bg-background px-1"
            >
              <option value="transacional">E-mail do VagaPilot</option>
              {gmailSend ? <option value="gmail">Meu Gmail (para mim mesmo)</option> : null}
            </select>
          </label>
        </details>
      ) : null}
      {accepted ? (
        <div>
          <Button size="sm" variant="outline" onClick={revoke} disabled={busy}>
            Revogar aceite
          </Button>
        </div>
      ) : null}
    </div>
  )
}
