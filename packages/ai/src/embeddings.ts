import { createGateway, embedMany, type EmbeddingModel } from "ai"

import { EMBEDDING_DIMENSIONS, getAiConfig, type AiConfig } from "./config.js"
import { createFakeEmbeddingModel, FAKE_MODEL_ID } from "./fake.js"

type EmbeddingCallOptions = {
  dimensions?: number
  providerOptions?: {
    google: { outputDimensionality: number }
  }
}

/**
 * Gemini embeddings default to 3072. The database columns are vector(1536),
 * so the gateway must be asked for that size. `gemini-embedding-001` is used
 * because it returns one vector per text (embedding-2 aggregates a batch).
 */
export function embeddingCallOptions(modelId: string): EmbeddingCallOptions {
  if (!modelId.startsWith("google/gemini-embedding")) return {}
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS },
    },
  }
}

/**
 * Truncated `gemini-embedding-001` vectors are not unit length.
 * `gemini-embedding-2` renormalizes itself. Cosine search is scale-invariant,
 * but stored vectors stay unit length so they match the rest of the pipeline.
 */
export function normalizeEmbedding(
  modelId: string,
  vector: number[]
): number[] {
  if (!modelId.includes("gemini-embedding-001")) return vector
  const norm = Math.hypot(...vector)
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

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

/** Embeddings from `EMBEDDING_MODEL`. Gemini is asked for 1536 dimensions to match the database. */
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
      ...embeddingCallOptions(resolved.id),
    })
    const normalized: number[][] = []
    for (const embedding of embeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding model ${resolved.id} returned ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`
        )
      }
      normalized.push(normalizeEmbedding(resolved.id, embedding))
    }
    return normalized
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
