/**
 * FAKE, DETERMINISTIC AI PROVIDER — for tests and local dev without an LLM key.
 *
 * It does not understand language: it reads the CV line by line with simple rules
 * (section headings, "Empresa — Cargo" headers, bullets) and copies lines verbatim as
 * excerpts. Output quality is far below a real model; never use it in production.
 */
import { normalizeForGrounding, type FactKind } from "@vagapilot/core/facts"
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test"

import { EMBEDDING_DIMENSIONS } from "./config.js"
import type { CvExperience, CvExtraction, CvFact } from "./schemas.js"

export const FAKE_MODEL_ID = "vagapilot-fake-v1"

type Section =
  "experience" | "languages" | "skills" | "certifications" | "other"

const SECTION_HEADINGS: Record<string, Section> = {
  experiencia: "experience",
  experiencias: "experience",
  "experiencia profissional": "experience",
  experience: "experience",
  idiomas: "languages",
  languages: "languages",
  competencias: "skills",
  habilidades: "skills",
  skills: "skills",
  certificacoes: "certifications",
  certifications: "certifications",
  formacao: "other",
  education: "other",
  resumo: "other",
  summary: "other",
}

const KNOWN_TOOLS = [
  "kubernetes",
  "go",
  "python",
  "postgresql",
  "terraform",
  "opentelemetry",
  "grafana",
  "ci/cd",
  "aws",
  "java",
  "typescript",
  "react",
]

const BULLET = /^\s*[-•*▪◦]\s+/
const HEADER = /^(.+?)\s+[—–-]\s+(.+)$/
const PERIOD =
  /(\d{2})\/(\d{4})\s*[–—-]\s*(?:(\d{2})\/(\d{4})|atual|presente|current|present)/i

function headingOf(line: string): Section | undefined {
  return SECTION_HEADINGS[normalizeForGrounding(line).replace(/:$/, "")]
}

function toolsIn(text: string): string[] {
  const normalized = ` ${normalizeForGrounding(text).replace(/[.,;()]/g, " ")} `
  return KNOWN_TOOLS.filter((tool) => normalized.includes(` ${tool} `))
}

function achievementKind(text: string): FactKind {
  return /\d+\s*(%|mil\b|horas|minutos|pedidos|projetos)/i.test(text)
    ? "metrica"
    : "conquista"
}

/** Rule-based extraction used by the fake model. Exported for tests. */
export function fakeExtractFromCv(text: string): CvExtraction {
  const experiences: CvExperience[] = []
  const facts: CvFact[] = []
  let section: Section = "other"
  let current: CvExperience | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = headingOf(line)
    if (heading) {
      section = heading
      current = undefined
      continue
    }

    switch (section) {
      case "experience": {
        if (BULLET.test(line)) {
          const statement = line.replace(BULLET, "").trim()
          facts.push({
            statement,
            kind: achievementKind(statement),
            tags: toolsIn(statement),
            experienceHint: current?.company ?? null,
            excerpt: statement,
          })
          break
        }
        const period = PERIOD.exec(line)
        if (period && current) {
          current.startMonth = `${period[2]}-${period[1]}`
          current.endMonth =
            period[3] && period[4] ? `${period[4]}-${period[3]}` : null
          current.isCurrent = !period[3]
          break
        }
        const header = HEADER.exec(line)
        if (header?.[1] && header[2]) {
          current = {
            company: header[1].trim(),
            title: header[2].trim(),
            startMonth: null,
            endMonth: null,
            isCurrent: false,
            excerpt: line,
          }
          experiences.push(current)
        }
        break
      }
      case "languages":
        facts.push({
          statement: line.replace(/\s+[—–-]\s+/, " "),
          kind: "idioma",
          tags: ["idioma"],
          experienceHint: null,
          excerpt: line,
        })
        break
      case "skills":
        for (const skill of line.split(/[,;]/).map((s) => s.trim())) {
          if (skill.length < 2) continue
          facts.push({
            statement: skill,
            kind: toolsIn(skill).length > 0 ? "ferramenta" : "competencia",
            tags: [normalizeForGrounding(skill)],
            experienceHint: null,
            excerpt: skill,
          })
        }
        break
      case "certifications":
        facts.push({
          statement: line,
          kind: "certificacao",
          tags: ["certificacao"],
          experienceHint: null,
          excerpt: line,
        })
        break
      case "other":
        break
      default: {
        const unreachable: never = section
        throw new Error(`Unhandled CV section: ${String(unreachable)}`)
      }
    }
  }

  return { experiences, facts }
}

const usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
}

/** Fake language model that answers the extraction call with `fakeExtractFromCv(cvText)`. */
export function createFakeExtractionModel(cvText: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "vagapilot-fake",
    modelId: FAKE_MODEL_ID,
    doGenerate: async () => ({
      content: [
        { type: "text", text: JSON.stringify(fakeExtractFromCv(cvText)) },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  })
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic hashed bag-of-words vector (unit length). Similar texts share dimensions. */
export function fakeEmbedding(
  text: string,
  dimensions: number = EMBEDDING_DIMENSIONS
): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  const tokens = normalizeForGrounding(text)
    .split(/[^a-z0-9/+#]+/)
    .filter((token) => token.length > 1)
  for (const token of tokens) {
    const hash = fnv1a(token)
    const index = hash % dimensions
    vector[index] = (vector[index] ?? 0) + (hash & 1 ? 1 : -1)
  }
  const norm = Math.hypot(...vector)
  if (norm === 0) {
    vector[0] = 1
    return vector
  }
  return vector.map((value) => value / norm)
}

export function createFakeEmbeddingModel(): MockEmbeddingModelV4 {
  return new MockEmbeddingModelV4({
    provider: "vagapilot-fake",
    modelId: FAKE_MODEL_ID,
    maxEmbeddingsPerCall: 256,
    supportsParallelCalls: true,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((value) => fakeEmbedding(value)),
      warnings: [],
    }),
  })
}
