"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  ACTION_INFO,
  DATA_CATEGORIES,
  MODE_LABELS,
  PERMISSION_MODES,
  isGrant,
  type DataCategory,
  type PermissionAction,
  type PermissionMode,
} from "@vagapilot/core/permissions"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { CategoryGrant, type Grant } from "@/components/permissions/category-grant"
import type { PermissionsView } from "@/lib/permissions/server"

import {
  addPermissionRuleAction,
  addRuleCategoriesAction,
  removePermissionRuleAction,
  revokePermissionCategoryAction,
  setNotifySensitiveAction,
  setPermissionModeAction,
} from "./actions"

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)" : "nunca"

const catLabel = (c: string) => DATA_CATEGORIES[c as DataCategory]?.label ?? c

type Pending =
  | { kind: "mode"; action: PermissionAction; mode: PermissionMode }
  | { kind: "rule"; action: PermissionAction; pattern: string }
  | { kind: "ruleCats"; ruleId: string; action: PermissionAction }
  | null

export function PermissionsClient({ view }: { view: PermissionsView }) {
  const [busy, start] = useTransition()
  const [pending, setPending] = useState<Pending>(null)
  const [draft, setDraft] = useState<{ action: PermissionAction; pattern: string; effect: "allow" | "deny" }>({
    action: "accept_site_terms",
    pattern: "",
    effect: "allow",
  })

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done = "Salvo.") =>
    start(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(done)
        setPending(null)
      } else toast.error(r.error ?? "Erro.")
    })

  const confirm = (grant: Grant) => {
    if (!pending) return
    if (pending.kind === "mode")
      run(() => setPermissionModeAction({ action: pending.action, mode: pending.mode, grant }), "Permissão ativada e registrada.")
    else if (pending.kind === "rule")
      run(() => addPermissionRuleAction({ action: pending.action, pattern: pending.pattern, effect: "allow", grant }), "Regra adicionada e registrada.")
    else run(() => addRuleCategoriesAction({ ruleId: pending.ruleId, grant }), "Categorias adicionadas.")
  }

  return (
    <div className="flex flex-col gap-6">
      {pending ? (
        <CategoryGrant
          title={
            pending.kind === "mode"
              ? `${ACTION_INFO[pending.action].title}: ${MODE_LABELS[pending.mode]}`
              : pending.kind === "rule"
                ? `${ACTION_INFO[pending.action].title}: permitir em ${pending.pattern}`
                : `${ACTION_INFO[pending.action].title}: adicionar categorias`
          }
          needsFinalConfirmation={pending.action === "final_submit" && pending.kind !== "ruleCats"}
          pending={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      ) : null}

      <section aria-labelledby="modes" className="flex flex-col gap-2">
        <h3 id="modes" className="text-lg font-bold tracking-tight">Modo por ação</h3>
        <ul className="flex flex-col gap-2">
          {view.settings.map((s) => (
            <li key={s.action} className="flex flex-col gap-1 rounded border p-3 text-sm">
              <p className="font-semibold">{ACTION_INFO[s.action].title}</p>
              <p className="text-muted-foreground">{ACTION_INFO[s.action].description}</p>
              <label className="flex items-center gap-2">
                Modo:
                <select
                  className="rounded border bg-background p-1"
                  value={s.mode}
                  disabled={busy}
                  onChange={(e) => {
                    const mode = e.target.value as PermissionMode
                    if (isGrant(mode)) setPending({ kind: "mode", action: s.action, mode })
                    else run(() => setPermissionModeAction({ action: s.action, mode, grant: null }))
                  }}
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              {isGrant(s.mode) ? (
                <div className="flex flex-wrap gap-1">
                  Categorias confirmadas:
                  {s.categories.length ? (
                    s.categories.map((c) => (
                      <span key={c} className="flex items-center gap-1 rounded border px-1">
                        {catLabel(c)}
                        <button
                          type="button"
                          className="underline"
                          aria-label={`Revogar ${catLabel(c)}`}
                          onClick={() => run(() => revokePermissionCategoryAction({ action: s.action, category: c }), "Categoria revogada.")}
                        >
                          revogar
                        </button>
                      </span>
                    ))
                  ) : (
                    <span>nenhuma (o agente vai perguntar)</span>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-2">
        <h3 id="rules" className="text-lg font-bold tracking-tight">Sites permitidos e negados</h3>
        <p className="text-sm text-muted-foreground">
          Regras de permitir só valem nos modos “{MODE_LABELS.allowlist}” e “{MODE_LABELS.auto}”.
          Regras de negar valem sempre.
        </p>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <select
            className="rounded border bg-background p-1"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value as PermissionAction })}
          >
            {view.settings.map((s) => (
              <option key={s.action} value={s.action}>
                {ACTION_INFO[s.action].title}
              </option>
            ))}
          </select>
          <Input
            className="w-56"
            placeholder="*.gupy.io"
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          />
          <select
            className="rounded border bg-background p-1"
            value={draft.effect}
            onChange={(e) => setDraft({ ...draft, effect: e.target.value as "allow" | "deny" })}
          >
            <option value="allow">Permitir</option>
            <option value="deny">Negar</option>
          </select>
          <Button
            size="sm"
            disabled={busy || !draft.pattern.trim()}
            onClick={() =>
              draft.effect === "allow"
                ? setPending({ kind: "rule", action: draft.action, pattern: draft.pattern.trim() })
                : run(() => addPermissionRuleAction({ ...draft, grant: null }), "Regra adicionada.")
            }
          >
            Adicionar
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {view.rules.length === 0 ? <li className="text-sm text-muted-foreground">Nenhuma regra.</li> : null}
          {view.rules.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded border p-2 text-sm">
              <p>
                <strong>{r.effect === "allow" ? "Permitir" : "Negar"}</strong> · {ACTION_INFO[r.action].title} ·{" "}
                <code>{r.pattern}</code>
              </p>
              <p className="text-muted-foreground">
                Criada {when(r.createdAt)} {r.source === "run_card" ? "(pelo cartão da candidatura)" : ""} · último uso:{" "}
                {when(r.lastUsedAt)}
              </p>
              {r.effect === "allow" ? (
                <div className="flex flex-wrap gap-1">
                  {r.categories.map((c) => (
                    <span key={c} className="flex items-center gap-1 rounded border px-1">
                      {catLabel(c)}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => run(() => revokePermissionCategoryAction({ ruleId: r.id, category: c }), "Categoria revogada.")}
                      >
                        revogar
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setPending({ kind: "ruleCats", ruleId: r.id, action: r.action })}
                  >
                    + categoria
                  </button>
                </div>
              ) : null}
              <div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => removePermissionRuleAction({ id: r.id }), "Regra removida.")}>
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notify" className="flex flex-col gap-2 text-sm">
        <h3 id="notify" className="text-lg font-bold tracking-tight">Aviso de dados sensíveis</h3>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={view.notifySensitiveEmail}
            disabled={busy}
            onChange={(e) => run(() => setNotifySensitiveAction({ on: e.target.checked }))}
          />
          <span>
            Me avisar por e-mail quando o agente preencher dados notáveis (documentos, saúde,
            diversidade etc.) por uma permissão automática. O assunto nunca traz os dados; o
            relatório completo fica só no painel da candidatura.
          </span>
        </label>
      </section>

      <section aria-labelledby="activity" className="flex flex-col gap-2">
        <h3 id="activity" className="text-lg font-bold tracking-tight">Atividade recente</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {view.events.length === 0 ? <li className="text-muted-foreground">Nenhuma ação automática ainda.</li> : null}
          {view.events.map((e) => (
            <li key={e.id} className="rounded border p-2">
              {when(e.createdAt)} · {ACTION_INFO[e.action]?.title ?? e.action} · {e.site} ·{" "}
              <strong>{e.decision === "allow" ? "permitido" : "negado"}</strong> ({e.reason})
              {e.fieldLabel ? ` · “${e.fieldLabel}”` : ""}
              {e.termsUrl ? (
                <>
                  {" · "}
                  <a href={e.termsUrl} className="underline" target="_blank" rel="noreferrer">
                    termos
                  </a>
                  {e.termsSha256 ? ` (sha256 ${e.termsSha256.slice(0, 12)}…)` : ""}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
