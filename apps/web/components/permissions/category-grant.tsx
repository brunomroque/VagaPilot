"use client"

import { useState } from "react"

import {
  DATA_CATEGORIES,
  DATA_CATEGORY_KEYS,
  FINAL_SUBMIT_CONFIRMATION,
  PERMISSION_ACK_TEXT,
  SENSITIVE_CATEGORY_NOTE,
  SENSITIVE_CONFIRMATION,
  type DataCategory,
} from "@vagapilot/core/permissions"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

export type Grant = {
  categories: DataCategory[]
  acknowledged: boolean
  sensitiveConfirmation: string | null
  finalSubmitConfirmation: string | null
}

/**
 * Category confirmation for a standing permission. Every category starts UNTICKED (also
 * marketing); sensitive ones are highlighted and need a typed confirmation.
 */
export function CategoryGrant({
  title,
  highlight = [],
  needsFinalConfirmation = false,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string
  /** Categories this step touches / are missing (shown first, still unticked). */
  highlight?: readonly string[]
  needsFinalConfirmation?: boolean
  pending?: boolean
  onConfirm: (grant: Grant) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<DataCategory[]>([])
  const [ack, setAck] = useState(false)
  const [sensitiveTyped, setSensitiveTyped] = useState("")
  const [finalTyped, setFinalTyped] = useState("")
  const sensitive = picked.some((c) => DATA_CATEGORIES[c].sensitive)
  const order = [
    ...DATA_CATEGORY_KEYS.filter((c) => highlight.includes(c)),
    ...DATA_CATEGORY_KEYS.filter((c) => !highlight.includes(c)),
  ]
  const ready =
    ack &&
    picked.length > 0 &&
    (!sensitive || sensitiveTyped.trim().toUpperCase() === SENSITIVE_CONFIRMATION) &&
    (!needsFinalConfirmation || finalTyped.trim().toUpperCase() === FINAL_SUBMIT_CONFIRMATION)
  return (
    <div role="dialog" aria-label={title} className="flex flex-col gap-3 rounded-md border-2 border-amber-500 p-3 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="rounded bg-amber-50 p-2 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {PERMISSION_ACK_TEXT}
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Quais dados o agente pode informar/aceitar sem perguntar?</legend>
        {order.map((c) => {
          const info = DATA_CATEGORIES[c]
          return (
            <label
              key={c}
              className={`flex items-start gap-2 rounded p-1 ${info.sensitive ? "border border-red-500 bg-red-50 dark:bg-red-950" : ""}`}
            >
              <input
                type="checkbox"
                checked={picked.includes(c)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))
                }
              />
              <span>
                {info.label}
                {info.sensitive ? <strong className="text-red-700 dark:text-red-300"> · sensível</strong> : null}
                {highlight.includes(c) ? <em> · usado nesta etapa</em> : null}
              </span>
            </label>
          )
        })}
      </fieldset>
      {sensitive ? (
        <div className="flex flex-col gap-1 rounded border border-red-500 p-2">
          <p className="text-red-800 dark:text-red-200">{SENSITIVE_CATEGORY_NOTE}</p>
          <label className="flex flex-col gap-1">
            Digite {SENSITIVE_CONFIRMATION} para confirmar
            <Input value={sensitiveTyped} onChange={(e) => setSensitiveTyped(e.target.value)} />
          </label>
        </div>
      ) : null}
      {needsFinalConfirmation ? (
        <label className="flex flex-col gap-1">
          Envio sem a sua revisão: digite {FINAL_SUBMIT_CONFIRMATION}
          <Input value={finalTyped} onChange={(e) => setFinalTyped(e.target.value)} />
        </label>
      ) : null}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>Li o texto destacado e nomeio o VagaPilot meu mandatário para esta ação.</span>
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!ready || pending}
          onClick={() =>
            onConfirm({
              categories: picked,
              acknowledged: ack,
              sensitiveConfirmation: sensitive ? sensitiveTyped : null,
              finalSubmitConfirmation: needsFinalConfirmation ? finalTyped : null,
            })
          }
        >
          Confirmar permissão
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
