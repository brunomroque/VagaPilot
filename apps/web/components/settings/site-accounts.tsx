"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  listSiteAccountsAction,
  resetSitePasswordAction,
  revealSitePasswordAction,
  type SiteAccountView,
} from "@/app/app/configuracoes/sites-actions"
import { Button } from "@workspace/ui/components/button"

/** Accounts the bot created on ATSs with the user's e-mail: view or reset the stored password. */
export function SiteAccounts() {
  const [accounts, setAccounts] = useState<SiteAccountView[]>([])
  const [shown, setShown] = useState<Record<string, string>>({})
  const [busy, startTransition] = useTransition()

  useEffect(() => {
    void listSiteAccountsAction().then((r) => {
      if (r.ok) setAccounts(r.data)
    })
  }, [])

  function toggle(site: string) {
    if (shown[site]) {
      setShown(({ [site]: _, ...rest }) => rest)
      return
    }
    startTransition(async () => {
      const r = await revealSitePasswordAction({ site })
      if (!r.ok) return void toast.error("Não consegui mostrar a senha.")
      setShown((s) => ({ ...s, [site]: r.data.password }))
    })
  }

  function reset(site: string) {
    if (
      !window.confirm(
        'Gerar uma nova senha? Depois troque a senha no próprio site ("Esqueci minha senha") para esta nova.'
      )
    )
      return
    startTransition(async () => {
      const r = await resetSitePasswordAction({ site })
      if (!r.ok) return void toast.error("Não consegui gerar outra senha.")
      setShown((s) => ({ ...s, [site]: r.data.password }))
      toast.success("Nova senha salva.")
    })
  }

  if (!accounts.length) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Contas criadas pelo VagaPilot</h3>
      <p className="text-xs text-muted-foreground">
        Cadastros feitos com seu e-mail em sites de vagas. A senha fica
        criptografada e só aparece aqui, para você.
      </p>
      <ul className="flex flex-col divide-y rounded-md border text-sm">
        {accounts.map((a) => (
          <li
            key={a.site}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <div className="flex flex-col">
              <strong>{a.site}</strong>
              <span className="text-xs text-muted-foreground">{a.email}</span>
              {shown[a.site] ? (
                <code className="mt-1 rounded bg-muted px-2 py-1 text-xs select-all">
                  {shown[a.site]}
                </code>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => toggle(a.site)}
              >
                {shown[a.site] ? "Ocultar senha" : "Ver senha"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => reset(a.site)}
              >
                Redefinir senha
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
