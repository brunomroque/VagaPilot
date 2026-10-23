import process from "node:process"

export type AiProviderMode = "gateway" | "google" | "fake"

export type AiConfig = {
  mode: AiProviderMode
  apiKey?: string
  baseURL?: string
  /** Small model for extraction and classification (spec 8.2). */
  extractionModel: string
  /** Large model for fit and the chat orchestrator (spec 8.2). */
  largeModel: string
  embeddingModel: string
  /** True when the fake provider was chosen only because no key exists (not forced). */
  missingKey?: boolean
  /** True on Netlify or NODE_ENV=production. */
  production?: boolean
}

export const DEFAULT_EXTRACTION_MODEL = "google/gemini-2.5-flash"
export const DEFAULT_LARGE_MODEL = "google/gemini-2.5-pro"
export const DEFAULT_EMBEDDING_MODEL = "google/gemini-embedding-001"
export const EMBEDDING_DIMENSIONS = 1536

type Env = Readonly<Record<string, string | undefined>>

export function isProductionEnv(env: Env = process.env): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.NETLIFY === "true" ||
    Boolean(env.NETLIFY_SITE_ID && env.CONTEXT)
  )
}

/**
 * Provider order: `AI_GATEWAY_API_KEY` (Vercel AI Gateway, any host) → `GOOGLE_GENERATIVE_AI_API_KEY`
 * (or `GEMINI_API_KEY`) calling Gemini directly → deterministic fake.
 * The fake runs under Vitest or with `AI_PROVIDER=fake` (dev without keys, e2e). In production a
 * fake caused by a missing key is reported as "IA indisponível" instead of heuristic numbers.
 */
export function getAiConfig(env: Env = process.env): AiConfig {
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim() || undefined
  const googleKey =
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    undefined
  const forcedFake = env.AI_PROVIDER === "fake" || Boolean(env.VITEST)
  let mode: AiProviderMode = "fake"
  let apiKey: string | undefined
  if (!forcedFake && gatewayKey) {
    mode = "gateway"
    apiKey = gatewayKey
  } else if (!forcedFake && googleKey) {
    mode = "google"
    apiKey = googleKey
  }
  return {
    mode,
    apiKey,
    baseURL:
      mode === "gateway"
        ? env.AI_GATEWAY_BASE_URL?.trim() || undefined
        : undefined,
    extractionModel: env.LLM_MODEL_SMALL?.trim() || DEFAULT_EXTRACTION_MODEL,
    largeModel: env.LLM_MODEL_LARGE?.trim() || DEFAULT_LARGE_MODEL,
    embeddingModel: env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    missingKey: mode === "fake" && !forcedFake,
    production: isProductionEnv(env),
  }
}

/** Fake mode in production because no key is configured: callers must show "IA indisponível". */
export function isAiUnavailable(config: AiConfig = getAiConfig()): boolean {
  return config.mode === "fake" && Boolean(config.missingKey && config.production)
}

export class AiUnavailableError extends Error {
  readonly code = "ai_unavailable"
  constructor() {
    super(
      "IA indisponível: configure GOOGLE_GENERATIVE_AI_API_KEY (ou AI_GATEWAY_API_KEY) no ambiente."
    )
    this.name = "AiUnavailableError"
  }
}

/** Maps "google/gemini-2.5-pro" → "gemini-2.5-pro" for the direct Google provider. */
export function toGoogleModelId(id: string): string {
  return id.startsWith("google/") ? id.slice("google/".length) : id
}
