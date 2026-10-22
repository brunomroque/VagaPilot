import type { ApplicationStatus } from "@vagapilot/core/status"

/**
 * Fixed status palette of the PDF report (F10A RF10A.2: Enviada azul, Em análise amarelo,
 * Entrevista verde, Reprovada vermelho, Pulada cinza, Pendente laranja). Rows use the light
 * `row` tint under dark text (contrast ≥ 7:1); the legend pairs each `swatch` with its label,
 * so color is never the only cue.
 */
export const STATUS_PALETTE = {
  rascunho: { row: "#EEF2F6", swatch: "#64748B" },
  em_andamento: { row: "#E6E9FB", swatch: "#4F46E5" },
  enviada: { row: "#DCE8FD", swatch: "#1D4ED8" },
  em_analise: { row: "#FDF3C4", swatch: "#A16207" },
  etapa_pendente: { row: "#FDE6D2", swatch: "#C2410C" },
  entrevista: { row: "#DAF5E2", swatch: "#15803D" },
  proposta: { row: "#D4F4EE", swatch: "#0F766E" },
  reprovada: { row: "#FCE1E1", swatch: "#B91C1C" },
  encerrada: { row: "#E7E8EA", swatch: "#4B5563" },
  descartada: { row: "#F2F3F4", swatch: "#6B7280" },
} as const satisfies Record<ApplicationStatus, { row: string; swatch: string }>

export const REPORT_TEXT = "#18211D"
export const REPORT_MUTED = "#4F5A54"
export const REPORT_PRIMARY = "#1F5C46"
export const REPORT_BORDER = "#DFE5E1"
