import type { LanguageModelV4 } from "@ai-sdk/provider"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGateway, type EmbeddingModel, type LanguageModel } from "ai"

import { toGoogleModelId, type AiConfig } from "./config.js"

/** Real language model for gateway/google modes. Fake mode is handled by callers. */
export function realLanguageModel(config: AiConfig, id: string): LanguageModel {
  if (config.mode === "gateway") {
    return createGateway({ apiKey: config.apiKey, baseURL: config.baseURL })(id)
  }
  if (config.mode === "google") {
    const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
    const primary = google(toGoogleModelId(id))
    const fallbackId = config.fallbackModel
    if (!fallbackId || toGoogleModelId(fallbackId) === toGoogleModelId(id)) {
      return primary
    }
    return withFallback(primary, google(toGoogleModelId(fallbackId)))
  }
  throw new Error(`No real language model for mode ${config.mode}`)
}

/** Quota (429), overload (5xx) or a retired model (404): worth retrying on another model. */
export function isFallbackWorthy(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as {
      statusCode?: number
      lastError?: unknown
      cause?: unknown
      message?: string
    }
    const status = e.statusCode
    if (status === 429 || status === 404 || (status ?? 0) >= 500) return true
    if (
      typeof e.message === "string" &&
      /quota|rate limit|overloaded|RESOURCE_EXHAUSTED/i.test(e.message)
    ) {
      return true
    }
    current = e.lastError ?? e.cause
  }
  return false
}

/**
 * Free-tier Gemini quotas are per model and per minute: when the primary model is out of quota,
 * the call goes to the fallback model instead of failing the whole chat turn.
 */
export function withFallback(
  primary: LanguageModelV4,
  fallback: LanguageModelV4
): LanguageModelV4 {
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options) {
      try {
        return await primary.doGenerate(options)
      } catch (error) {
        if (!isFallbackWorthy(error)) throw error
        console.warn("model fallback", {
          from: primary.modelId,
          to: fallback.modelId,
        })
        return fallback.doGenerate(options)
      }
    },
    async doStream(options) {
      try {
        return await primary.doStream(options)
      } catch (error) {
        if (!isFallbackWorthy(error)) throw error
        console.warn("model fallback", {
          from: primary.modelId,
          to: fallback.modelId,
        })
        return fallback.doStream(options)
      }
    },
  } as LanguageModelV4
}

export function realEmbeddingModel(config: AiConfig): EmbeddingModel {
  if (config.mode === "gateway") {
    return createGateway({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }).embeddingModel(config.embeddingModel)
  }
  if (config.mode === "google") {
    return createGoogleGenerativeAI({ apiKey: config.apiKey }).embeddingModel(
      toGoogleModelId(config.embeddingModel)
    )
  }
  throw new Error(`No real embedding model for mode ${config.mode}`)
}
