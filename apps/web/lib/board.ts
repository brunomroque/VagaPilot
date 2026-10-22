import {
  allowedTransitions,
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@vagapilot/core/status"

/** The four visual columns of the Figma kanban. The database keeps the fine status (spec 9.4). */
export const boardColumns = [
  "descobertas",
  "candidatadas",
  "em_processo",
  "decisao",
] as const

export type BoardColumn = (typeof boardColumns)[number]

/** Every application_status lands in exactly one visual column. */
export const columnByStatus = {
  rascunho: "descobertas",
  em_andamento: "descobertas",
  enviada: "candidatadas",
  em_analise: "candidatadas",
  etapa_pendente: "em_processo",
  entrevista: "em_processo",
  proposta: "em_processo",
  reprovada: "decisao",
  encerrada: "decisao",
  descartada: "decisao",
} as const satisfies Record<ApplicationStatus, BoardColumn>

export function isBoardColumn(value: unknown): value is BoardColumn {
  return (
    typeof value === "string" &&
    (boardColumns as readonly string[]).includes(value)
  )
}

export function statusesInColumn(column: BoardColumn): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter(
    (status) => columnByStatus[status] === column
  )
}

export type DropResolution =
  | { kind: "same_column" }
  | { kind: "invalid"; target: ApplicationStatus }
  | { kind: "single"; status: ApplicationStatus }
  | { kind: "choose"; options: ApplicationStatus[] }

/**
 * What dropping a card on a column means. The status machine (packages/core/status.ts) decides:
 * one allowed status applies directly, several ask the user, none is rejected.
 */
export function resolveDrop(
  from: ApplicationStatus,
  column: BoardColumn
): DropResolution {
  if (columnByStatus[from] === column) return { kind: "same_column" }
  const candidates = statusesInColumn(column)
  const allowed = allowedTransitions(from, { source: "usuario" }).filter(
    (status) => candidates.includes(status)
  )
  const [first] = allowed
  if (allowed.length === 1 && first) return { kind: "single", status: first }
  if (allowed.length > 1) return { kind: "choose", options: allowed }
  return { kind: "invalid", target: candidates[0] ?? from }
}
