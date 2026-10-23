import { describe, expect, it } from "vitest"

import { isUniqueViolation } from "./postgres.js"

describe("isUniqueViolation", () => {
  it("recognizes Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true)
    expect(
      isUniqueViolation({
        message: "duplicate key value violates unique constraint",
      })
    ).toBe(true)
    expect(isUniqueViolation({ code: "23503" })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
