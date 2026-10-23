"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  deleteProviderAction,
  saveProviderAction,
  testProviderAction,
  toggleProviderAction,
  type ProviderInput,
} from "@/app/app/admin/actions"
import type { AdminDashboard, AdminProviderRow } from "@/lib/admin/server"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Progress } from "@workspace/ui/components/progress"

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`)
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"

const EMPTY: ProviderInput = {
  provider: "browserless",
  label: "",
  accountEmail: null,
  secretEnvVar: "",
  projectEnvVar: null,
  enabled: true,
  priority: 100,
  concurrencyLimit: 1,
  maxSessionSeconds: 900,
  quotaKind: "units_monthly",
  quotaUnit: "units",
  quotaLimit: 0,
  costPerMinute: 1,
  quotaResetDay: 1,
  keyExpiresAt: null,
  alertThreshold: 0.8,
  notes: null,
}

function toInput(p: AdminProviderRow): ProviderInput {
  return {
    provider: p.provider,
    label: p.label,
    accountEmail: p.accountEmail,
    secretEnvVar: p.secretEnvVar,
    projectEnvVar: p.projectEnvVar,
    enabled: p.enabled,
    priority: p.priority,
    concurrencyLimit: p.concurrencyLimit,
    maxSessionSeconds: p.maxSessionSeconds,
    quotaKind: p.quotaKind,
    quotaUnit: p.quotaUnit,
    quotaLimit: p.quotaLimit,
    costPerMinute: p.costPerMinute,
    quotaResetDay: p.quotaResetDay,
    keyExpiresAt: p.keyExpiresAt ? p.keyExpiresAt.slice(0, 10) : null,
    alertThreshold: p.alertThreshold,
    notes: p.notes,
  }
}

export function BrowserPoolAdmin({ dashboard }: { dashboard: AdminDashboard }) {
  const [editing, setEditing] = useState<{ id: string | null; value: ProviderInput } | null>(null)
  const [busy, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const r = await fn()
      if (r.ok) toast.success(success)
      else toast.error(r.error ?? "Falhou.")
    })
  }

  function test(id: string) {
    startTransition(async () => {
      const r = await testProviderAction(id)
      if (!r.ok) toast.error(r.error)
      else if (r.data.ok) toast.success(`OK em ${r.data.latencyMs} ms. ${r.data.message}`)
      else toast.error(r.data.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {!dashboard.poolEnabled ? (
        <p className="rounded-md border border-amber-500/50 p-3 text-sm">
          BROWSER_POOL_ENABLED não está &quot;true&quot; neste ambiente: a candidatura na nuvem fica desligada.
        </p>
      ) : null}

      {dashboard.alerts.length ? (
        <Card>
          <CardHeader><CardTitle>Alertas</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {dashboard.alerts.map((a, i) => (
                <li key={`${a.providerId}-${a.kind}-${i}`}>
                  <Badge variant={a.kind.includes("exhausted") || a.kind.includes("expired") || a.kind === "missing_secret" ? "destructive" : "secondary"}>
                    {a.label}
                  </Badge>{" "}
                  {a.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Cota total (provedores ativos)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {dashboard.totals.map((t) => (
            <div key={t.unit} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.unit}</span>
              <Progress value={Math.min(100, t.percent * 100)} />
              <span className="text-muted-foreground">
                {fmt(t.used)} / {fmt(t.limit)} ({pct(t.percent)}) · projeção {t.projected === null ? "—" : fmt(t.projected)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Provedores</h3>
        <Button size="sm" onClick={() => setEditing({ id: null, value: EMPTY })}>Novo provedor</Button>
      </div>

      {editing ? (
        <ProviderForm
          value={editing.value}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(value) =>
            startTransition(async () => {
              const r = await saveProviderAction(editing.id, value)
              if (r.ok) {
                toast.success("Salvo.")
                setEditing(null)
              } else toast.error(r.error)
            })
          }
        />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {dashboard.providers.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {p.label}
                <Badge variant="outline">{p.provider}</Badge>
                {p.enabled ? <Badge>ativo</Badge> : <Badge variant="secondary">desativado</Badge>}
                {!p.hasSecret ? <Badge variant="destructive">sem chave</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Progress value={Math.min(100, p.quota.percent * 100)} />
              <span>
                {fmt(p.quota.used)} / {fmt(p.quota.limit)} {p.quotaUnit} ({pct(p.quota.percent)}) · restante {fmt(p.quota.remaining)} · projeção {pct(p.quota.projectedPercent)}
              </span>
              <span className="text-muted-foreground">
                Prioridade {p.priority} · {p.activeSessions}/{p.concurrencyLimit} sessões · máx {p.maxSessionSeconds ?? "—"} s ·{" "}
                {p.quotaKind === "credits_one_time" ? "crédito único" : `renova dia ${p.quotaResetDay ?? "—"}`} · chave em {p.secretEnvVar}
                {p.projectEnvVar ? ` + ${p.projectEnvVar}` : ""}
              </span>
              {p.accountEmail ? <span className="text-muted-foreground">Conta: {p.accountEmail}</span> : null}
              {p.keyExpiresAt ? <span className="text-muted-foreground">Chave expira: {when(p.keyExpiresAt)}</span> : null}
              <span className="text-muted-foreground">
                Último teste: {when(p.lastTestAt)} {p.lastTestOk === null ? "" : p.lastTestOk ? "✓" : "✗"} {p.lastTestMessage ?? ""}
              </span>
              {p.notes ? <p className="text-muted-foreground text-xs">{p.notes}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => test(p.id)}>Testar conexão</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ id: p.id, value: toInput(p) })}>Editar</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => toggleProviderAction(p.id, !p.enabled), p.enabled ? "Desativado." : "Ativado.")}>
                  {p.enabled ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Excluir ${p.label}? O histórico de sessões é mantido.`))
                      run(() => deleteProviderAction(p.id), "Excluído.")
                  }}
                >
                  Excluir
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Últimas sessões</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2">Início</th><th className="pr-2">Provedor</th><th className="pr-2">Tipo</th>
                <th className="pr-2">Status</th><th className="pr-2">Duração</th><th className="pr-2">Uso</th><th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-1 pr-2">{when(s.startedAt)}</td>
                  <td className="pr-2">{s.provider}</td>
                  <td className="pr-2">{s.purpose}</td>
                  <td className="pr-2">{s.status}</td>
                  <td className="pr-2">{s.durationSeconds === null ? "—" : `${s.durationSeconds} s`}</td>
                  <td className="pr-2">{fmt(s.unitsUsed)}</td>
                  <td className="max-w-64 truncate" title={s.errorMessage ?? ""}>{s.errorCode ?? ""}</td>
                </tr>
              ))}
              {!dashboard.sessions.length ? (
                <tr><td colSpan={7} className="py-2 text-muted-foreground">Nenhuma sessão ainda.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function ProviderForm({
  value: initial,
  busy,
  onSave,
  onCancel,
}: {
  value: ProviderInput
  busy: boolean
  onSave: (v: ProviderInput) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  const set = <K extends keyof ProviderInput>(k: K, value: ProviderInput[K]) => setV((s) => ({ ...s, [k]: value }))
  const num = (s: string) => (s.trim() === "" ? null : Number(s))
  const text = (s: string) => (s.trim() === "" ? null : s.trim())
  const field = (label: string, node: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {node}
    </label>
  )
  const select = "h-8 rounded-md border bg-transparent px-2 text-sm"
  return (
    <Card>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
        {field("Provedor", (
          <select className={select} value={v.provider} onChange={(e) => set("provider", e.target.value as ProviderInput["provider"])}>
            {["browserless", "steel", "kernel", "browserbase", "hyperbrowser"].map((p) => <option key={p}>{p}</option>)}
          </select>
        ))}
        {field("Nome", <Input value={v.label} onChange={(e) => set("label", e.target.value)} />)}
        {field("E-mail da conta", <Input value={v.accountEmail ?? ""} onChange={(e) => set("accountEmail", text(e.target.value))} />)}
        {field("Variável da chave (nome, não o valor)", <Input value={v.secretEnvVar} onChange={(e) => set("secretEnvVar", e.target.value.toUpperCase())} />)}
        {field("Variável do projeto (opcional)", <Input value={v.projectEnvVar ?? ""} onChange={(e) => set("projectEnvVar", text(e.target.value.toUpperCase()))} />)}
        {field("Prioridade (menor = primeiro)", <Input type="number" value={v.priority} onChange={(e) => set("priority", Number(e.target.value))} />)}
        {field("Concorrência", <Input type="number" value={v.concurrencyLimit} onChange={(e) => set("concurrencyLimit", Number(e.target.value))} />)}
        {field("Sessão máx. (s)", <Input type="number" value={v.maxSessionSeconds ?? ""} onChange={(e) => set("maxSessionSeconds", num(e.target.value))} />)}
        {field("Tipo de cota", (
          <select className={select} value={v.quotaKind} onChange={(e) => set("quotaKind", e.target.value as ProviderInput["quotaKind"])}>
            <option value="units_monthly">unidades/mês</option>
            <option value="credits_monthly">créditos/mês</option>
            <option value="credits_one_time">crédito único</option>
          </select>
        ))}
        {field("Unidade", <Input value={v.quotaUnit} onChange={(e) => set("quotaUnit", e.target.value)} />)}
        {field("Limite", <Input type="number" value={v.quotaLimit} onChange={(e) => set("quotaLimit", Number(e.target.value))} />)}
        {field("Custo por minuto (na unidade)", <Input type="number" step="any" value={v.costPerMinute} onChange={(e) => set("costPerMinute", Number(e.target.value))} />)}
        {field("Dia de renovação", <Input type="number" value={v.quotaResetDay ?? ""} onChange={(e) => set("quotaResetDay", num(e.target.value))} />)}
        {field("Chave expira em", <Input type="date" value={v.keyExpiresAt ?? ""} onChange={(e) => set("keyExpiresAt", text(e.target.value))} />)}
        {field("Alerta em (0–1)", <Input type="number" step="0.05" value={v.alertThreshold} onChange={(e) => set("alertThreshold", Number(e.target.value))} />)}
        {field("Notas", <Input value={v.notes ?? ""} onChange={(e) => set("notes", text(e.target.value))} />)}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Ativo
        </label>
        <div className="flex gap-2 sm:col-span-3">
          <Button size="sm" disabled={busy} onClick={() => onSave(v)}>Salvar</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  )
}
