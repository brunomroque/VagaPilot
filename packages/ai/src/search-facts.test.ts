import { describe, expect, it } from "vitest"

import { createEmbedder } from "./embeddings.js"
import { fakeEmbedding } from "./fake.js"
import { createFactSearch, type FactSearchHit } from "./search-facts.js"

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)
}

describe("fake embeddings", () => {
  it("are deterministic, unit length and 1536-dimensional", async () => {
    const embedder = createEmbedder()
    const [a, b] = await embedder.embedMany([
      "Kubernetes em produção",
      "Kubernetes em produção",
    ])
    expect(a).toHaveLength(1536)
    expect(a).toEqual(b)
    expect(Math.hypot(...(a ?? []))).toBeCloseTo(1, 6)
  })

  it("place related texts closer than unrelated ones", () => {
    const query = fakeEmbedding("experiência com Kubernetes")
    const related = fakeEmbedding("Liderou a migração para Kubernetes")
    const unrelated = fakeEmbedding("Inglês avançado")
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated))
  })
})

describe("searchFacts", () => {
  const hits: FactSearchHit[] = [
    {
      id: "1",
      experienceId: null,
      statement: "Confirmado",
      kind: "conquista",
      tags: [],
      status: "confirmado",
      similarity: 0.9,
    },
    {
      id: "2",
      experienceId: null,
      statement: "Proposto que vazou do store",
      kind: "conquista",
      tags: [],
      status: "proposto",
      similarity: 0.8,
    },
    {
      id: "3",
      experienceId: null,
      statement: "Rejeitado que vazou do store",
      kind: "conquista",
      tags: [],
      status: "rejeitado",
      similarity: 0.7,
    },
  ]

  it("CA2.2 ALWAYS returns only confirmed facts, even if the store misbehaves", async () => {
    const calls: number[] = []
    const searchFacts = createFactSearch({
      embedder: createEmbedder(),
      store: {
        async searchConfirmed(_userId, _embedding, k) {
          calls.push(k)
          return hits
        },
      },
    })
    const result = await searchFacts("user", "Kubernetes", 5)
    expect(result.map((hit) => hit.id)).toEqual(["1"])
    expect(calls).toEqual([5])
  })

  it("clamps k and ignores empty queries", async () => {
    const calls: number[] = []
    const searchFacts = createFactSearch({
      embedder: createEmbedder(),
      store: {
        async searchConfirmed(_userId, _embedding, k) {
          calls.push(k)
          return []
        },
      },
    })
    expect(await searchFacts("user", "   ")).toEqual([])
    await searchFacts("user", "x", 500)
    await searchFacts("user", "x", 0)
    expect(calls).toEqual([50, 1])
  })
})
