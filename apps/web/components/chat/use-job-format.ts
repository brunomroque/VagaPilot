"use client"

import { useFormatter, useTranslations } from "next-intl"

import type { AlertView, JobCardData } from "@/lib/chat/types"

/** Labels for job cards, built from `Jobs` translations (all UI strings via next-intl). */
export function useJobFormat() {
  const t = useTranslations("Jobs")
  const tStatus = useTranslations("Status")
  const format = useFormatter()

  function money(amount: number, currency: string) {
    return format.number(amount, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    })
  }

  function level(value: unknown): string {
    switch (value) {
      case "basico":
      case "intermediario":
      case "avancado":
      case "fluente":
      case "nativo":
      case "nao_informado":
        return t(`levels.${value}`)
      default:
        return String(value ?? "")
    }
  }

  function alertText(alert: AlertView): string {
    const params = alert.params ?? {}
    switch (alert.code) {
      case "idioma":
        return t("alerts.idioma", {
          language: String(params.language ?? ""),
          required: level(params.required),
          declared: level(params.declared),
        })
      case "local":
        return t("alerts.local", { location: String(params.location ?? "") })
      case "modelo":
        return t("alerts.modelo", {
          model: workModel(String(params.workModel ?? "")) ?? "",
        })
      case "regime":
        return t("alerts.regime", {
          regime: String(params.regime ?? "").toUpperCase(),
        })
      case "senioridade_acima":
        return t("alerts.senioridade_acima")
      case "senioridade_abaixo":
        return t("alerts.senioridade_abaixo")
      case "salario_fora":
        return params.direction === "acima"
          ? t("alerts.salario_fora_acima")
          : t("alerts.salario_fora_abaixo")
      default:
        return alert.message
    }
  }

  function workModel(value: string | null): string | null {
    switch (value) {
      case "presencial":
      case "hibrido":
      case "remoto":
        return t(`workModels.${value}`)
      default:
        return null
    }
  }

  function regime(value: string | null): string | null {
    switch (value) {
      case "clt":
      case "pj":
      case "ambos":
        return t(`regimes.${value}`)
      default:
        return null
    }
  }

  function meta(card: JobCardData): string[] {
    return [
      card.location,
      workModel(card.workModel),
      regime(card.regime),
    ].filter((value): value is string => Boolean(value))
  }

  function fitLabel(card: JobCardData): string | null {
    if (!card.fit) return null
    return card.score === null
      ? t(`fit.${card.fit}`)
      : t("fitWithScore", { fit: t(`fit.${card.fit}`), score: card.score })
  }

  function salaryLabel(card: JobCardData): string | null {
    const salary = card.salary
    const amount = salary.override ?? salary.target
    const period = t(
      `periods.${salary.period === "anual" || salary.period === "hora" ? salary.period : "mensal"}`
    )
    const own =
      amount !== null
        ? `${money(amount, salary.currency)}${period}${salary.regime ? ` · ${salary.regime.toUpperCase()}` : ""}`
        : null
    const range =
      salary.jobMin !== null || salary.jobMax !== null
        ? t("salary.jobRange", {
            range: [salary.jobMin, salary.jobMax]
              .filter((value): value is number => value !== null)
              .map((value) => money(value, salary.currency))
              .join("–"),
          })
        : null
    if (own) return range ? `${own} (${range})` : own
    if (salary.status === "no_rule") return range ?? t("salary.noRule")
    return range ?? t("salary.noSeniority")
  }

  function statusLabel(status: string | null | undefined): string {
    switch (status) {
      case "rascunho":
      case "descartada":
      case "em_andamento":
      case "enviada":
      case "em_analise":
      case "etapa_pendente":
      case "entrevista":
      case "proposta":
      case "reprovada":
      case "encerrada":
        return tStatus(status)
      default:
        return ""
    }
  }

  function date(value: string | null | undefined): string {
    if (!value) return ""
    return format.dateTime(new Date(value), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  function sourceLabel(source: string): string {
    switch (source) {
      case "linkedin":
      case "gupy":
      case "inhire":
      case "greenhouse":
      case "lever":
      case "workday":
      case "successfactors":
      case "quickin":
      case "jobbol":
      case "solides":
      case "email":
      case "indicacao":
        return t(`sources.${source}`)
      default:
        return t("sources.outro")
    }
  }

  return {
    t,
    meta,
    fitLabel,
    salaryLabel,
    alertText,
    workModel,
    regime,
    statusLabel,
    date,
    money,
    sourceLabel,
  }
}
