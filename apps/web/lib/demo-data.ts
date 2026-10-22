/*
 * FICTITIOUS records from the Figma prototype (docs/figma/ux_v1) for screens that still have no
 * data source. People and processes are invented. The tracker reads Supabase since P3.
 */

export type DemoResume = {
  id: string
  track: string
  language: "pt-BR" | "en"
  updated: string
  score: number
}

export const demoProfile = {
  completion: 92,
  plan: { used: 18, limit: 30 },
} as const

export const demoResumes: DemoResume[] = [
  {
    id: "r1",
    track: "Executivo & Híbrido",
    language: "pt-BR",
    updated: "Atualizado há 2 dias",
    score: 92,
  },
  {
    id: "r2",
    track: "Gestão de Engenharia",
    language: "pt-BR",
    updated: "Atualizado há 1 semana",
    score: 88,
  },
  {
    id: "r3",
    track: "Engineering Leadership",
    language: "en",
    updated: "Revisão recomendada",
    score: 76,
  },
]
