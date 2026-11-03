import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
}))

vi.mock("@/lib/server/admin", () => ({
  getAdminClient: () => mocks.admin,
}))

const { loadCurrentLegalDocuments } = await import("./server")

beforeEach(() => {
  mocks.admin = null
})

describe("loadCurrentLegalDocuments", () => {
  it("returns admin_unavailable when admin client is missing", async () => {
    const result = await loadCurrentLegalDocuments(null)
    expect(result.error).toBe("admin_unavailable")
    expect(result.docs).toEqual({})
  })

  it("returns query_failed when the query errors", async () => {
    const chain = {
      in: () => chain,
      then(
        resolve: (v: {
          data: unknown
          error: { code: string; message: string }
        }) => void
      ) {
        resolve({ data: null, error: { code: "PGRST", message: "fail" } })
      },
    }
    mocks.admin = {
      from: () => ({
        select: () => chain,
      }),
    }
    const result = await loadCurrentLegalDocuments(mocks.admin as never)
    expect(result.error).toBe("query_failed")
    expect(result.docs).toEqual({})
  })
})
