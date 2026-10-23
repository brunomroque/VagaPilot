import { MockEmbeddingModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"

import { EMBEDDING_DIMENSIONS, getAiConfig } from "./config.js"
import {
  createEmbedder,
  embeddingCallOptions,
  normalizeEmbedding,
} from "./embeddings.js"

function vector(length: number, first: number, second = 0): number[] {
  const values = new Array<number>(length).fill(0)
  values[0] = first
  if (length > 1) values[1] = second
  return values
}

function modelReturning(modelId: string, embedding: number[]) {
  return new MockEmbeddingModelV4({
    provider: "test",
    modelId,
    maxEmbeddingsPerCall: 8,
    supportsParallelCalls: true,
    doEmbed: async () => ({ embeddings: [embedding], warnings: [] }),
  })
}

describe("embeddingCallOptions", () => {
  it("asks Gemini for the database width", () => {
    expect(embeddingCallOptions("google/gemini-embedding-001")).toEqual({
      dimensions: EMBEDDING_DIMENSIONS,
      providerOptions: {
        google: { outputDimensionality: EMBEDDING_DIMENSIONS },
      },
    })
  })

  it("leaves other models on their native size", () => {
    expect(embeddingCallOptions("openai/text-embedding-3-small")).toEqual({})
    expect(embeddingCallOptions("vagapilot-fake")).toEqual({})
  })
})

describe("normalizeEmbedding", () => {
  it("unit-normalizes truncated gemini-embedding-001 vectors", () => {
    const normalized = normalizeEmbedding(
      "google/gemini-embedding-001",
      vector(1536, 3, 4)
    )
    expect(normalized[0]).toBeCloseTo(0.6, 6)
    expect(normalized[1]).toBeCloseTo(0.8, 6)
    expect(Math.hypot(...normalized)).toBeCloseTo(1, 6)
  })

  it("leaves embedding-2 and other models unchanged", () => {
    const raw = vector(1536, 3, 4)
    expect(normalizeEmbedding("google/gemini-embedding-2", raw)).toBe(raw)
    expect(normalizeEmbedding("openai/text-embedding-3-small", raw)).toBe(raw)
  })
})

describe("createEmbedder", () => {
  it("defaults to gemini-embedding-001", () => {
    expect(getAiConfig({}).embeddingModel).toBe("google/gemini-embedding-001")
  })

  it("rejects a Gemini vector that is not 1536", async () => {
    const embedder = createEmbedder({
      model: modelReturning("google/gemini-embedding-001", vector(3072, 1)),
    })
    await expect(embedder.embed("texto")).rejects.toThrow(/3072/)
  })

  it("stores a unit vector when Gemini returns a truncated 1536 vector", async () => {
    const embedder = createEmbedder({
      model: modelReturning("google/gemini-embedding-001", vector(1536, 3, 4)),
    })
    const embedding = await embedder.embed("texto")
    expect(embedding).toHaveLength(1536)
    expect(embedding[0]).toBeCloseTo(0.6, 6)
    expect(Math.hypot(...embedding)).toBeCloseTo(1, 6)
  })
})
