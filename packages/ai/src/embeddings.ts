import { createGateway, embedMany, type EmbeddingModel } from "ai"

import { EMBEDDING_DIMENSIONS, getAiConfig, type AiConfig } from "./config.js"
import { createFakeEmbeddingModel, FAKE_MODEL_ID } from "./fake.js"

export type Embedder = {
  readonly model: string
  embed(text: string): Promise<number[]>
  embedMany(texts: readonly string[]): Promise<number[][]>
}

function resolveEmbeddingModel(config: AiConfig): {
  model: EmbeddingModel
  id: string
} {
  switch (config.mode) {
    case "fake":
      return { model: createFakeEmbeddingModel(), id: FAKE_MODEL_ID }
    case "gateway": {
      const gateway = createGateway({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      })
      return {
        model: gateway.embeddingModel(config.embeddingModel),
        id: config.embeddingModel,
      }
    }
    default: {
      const unreachable: never = config.mode
      throw new Error(`Unhandled AI provider mode: ${String(unreachable)}`)
    }
  }
}

/** Embeddings with the model configured by env (`EMBEDDING_MODEL`), always 1536 dimensions. */
export function createEmbedder(
  options: { config?: AiConfig; model?: EmbeddingModel } = {}
): Embedder {
  const resolved = options.model
    ? {
        model: options.model,
        id:
          typeof options.model === "string"
            ? options.model
            : options.model.modelId,
      }
    : resolveEmbeddingModel(options.config ?? getAiConfig())

  async function many(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const { embeddings } = await embedMany({
      model: resolved.model,
      values: [...texts],
      maxRetries: 1,
    })
    for (const embedding of embeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding model ${resolved.id} returned ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`
        )
      }
    }
    return embeddings
  }

  return {
    model: resolved.id,
    embedMany: many,
    async embed(text) {
      const [embedding] = await many([text])
      if (!embedding) throw new Error("Embedding model returned nothing")
      return embedding
    },
  }
}
