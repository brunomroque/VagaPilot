import process from "node:process"

export type AiProviderMode = "gateway" | "fake"

export type AiConfig = {
  mode: AiProviderMode
  apiKey?: string
  baseURL?: string
  /** Small model for extraction and classification (spec 8.2). */
  extractionModel: string
  /** Large model for fit and the chat orchestrator (spec 8.2). */
  largeModel: string
  embeddingModel: string
}

export const DEFAULT_EXTRACTION_MODEL = "google/gemini-2.5-flash"
export const DEFAULT_LARGE_MODEL = "google/gemini-2.5-pro"
export const DEFAULT_EMBEDDING_MODEL = "google/gemini-embedding-001"
export const EMBEDDING_DIMENSIONS = 1536

type Env = Readonly<Record<string, string | undefined>>

/**
 * Real LLM calls happen only with `AI_GATEWAY_API_KEY` set and never under Vitest.
 * `AI_PROVIDER=fake` forces the deterministic fake provider (dev without keys, e2e).
 */
export function getAiConfig(env: Env = process.env): AiConfig {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim() || undefined
  const forcedFake = env.AI_PROVIDER === "fake" || Boolean(env.VITEST)
  return {
    mode: apiKey && !forcedFake ? "gateway" : "fake",
    apiKey,
    baseURL: env.AI_GATEWAY_BASE_URL?.trim() || undefined,
    extractionModel: env.LLM_MODEL_SMALL?.trim() || DEFAULT_EXTRACTION_MODEL,
    largeModel: env.LLM_MODEL_LARGE?.trim() || DEFAULT_LARGE_MODEL,
    embeddingModel: env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
  }
}
