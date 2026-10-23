import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGateway, type EmbeddingModel, type LanguageModel } from "ai"

import { toGoogleModelId, type AiConfig } from "./config.js"

/** Real language model for gateway/google modes. Fake mode is handled by callers. */
export function realLanguageModel(config: AiConfig, id: string): LanguageModel {
  if (config.mode === "gateway") {
    return createGateway({ apiKey: config.apiKey, baseURL: config.baseURL })(id)
  }
  if (config.mode === "google") {
    return createGoogleGenerativeAI({ apiKey: config.apiKey })(
      toGoogleModelId(id)
    )
  }
  throw new Error(`No real language model for mode ${config.mode}`)
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
