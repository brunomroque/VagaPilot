"use client"

import { useState } from "react"

import {
  ACTION_INFO,
  CARD_CHOICES,
  DATA_CATEGORIES,
  type DataCategory,
  type PermissionAction,
} from "@vagapilot/core/permissions"
import { Button } from "@workspace/ui/components/button"

import { CategoryGrant, type Grant } from "./category-grant"

/** Run-panel card for an action the agent may do under a standing permission. */
export function PermissionRunCard({
  question,
  options,
  card,
  termsUrl,
  busy,
  onAnswer,
}: {
  question: string
  options: string[]
  card: { action: string; host: string | null; categories: string[]; missing: string[] }
  termsUrl: string | null
  busy: boolean
  onAnswer: (answer: string, grant?: Grant) => void
}) {
  const [granting, setGranting] = useState(false)
  const info = ACTION_INFO[card.action as PermissionAction]
  const label = (c: string) => DATA_CATEGORIES[c as DataCategory]?.label ?? c
  return (
    <div role="alertdialog" className="flex flex-col gap-2 rounded border border-amber-500/60 bg-amber-500/5 p-2 text-xs">
      <p>
        <strong>{info?.title ?? "Permissão do agente"}</strong>
        {card.host ? ` em ${card.host}` : ""}: “{question}”
      </p>
      {card.missing.length ? (
        <p>
          Falta autorizar: {card.missing.map(label).join(", ")}.{" "}
          {options.includes(CARD_CHOICES.always) ? (
            <button type="button" className="underline" onClick={() => setGranting(true)}>
              Adicionar categoria e permitir sempre neste site
            </button>
          ) : null}
        </p>
      ) : null}
      {termsUrl ? (
        <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Ler os termos do site
        </a>
      ) : null}
      {granting ? (
        <CategoryGrant
          title={`Sempre permitir neste site: ${info?.title ?? card.action}`}
          highlight={[...card.categories, ...card.missing]}
          pending={busy}
          onCancel={() => setGranting(false)}
          onConfirm={(grant) => {
            setGranting(false)
            onAnswer(CARD_CHOICES.always, grant)
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o}
              size="sm"
              variant={o === CARD_CHOICES.once ? "default" : "outline"}
              disabled={busy}
              onClick={() => (o === CARD_CHOICES.always ? setGranting(true) : onAnswer(o))}
            >
              {o}
            </Button>
          ))}
        </div>
      )}
      <p className="text-muted-foreground">
        “Permitir uma vez” vale só para esta candidatura. Negar em termos do site cancela a
        candidatura. Tudo fica registrado.
      </p>
    </div>
  )
}
