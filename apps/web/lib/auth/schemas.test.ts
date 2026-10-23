import { describe, expect, it } from "vitest"

import { credentialsSchema, signUpSchema } from "./schemas"

describe("auth schemas", () => {
  it("accepts login credentials", () => {
    const parsed = credentialsSchema.safeParse({
      email: "marina@vagapilot.test",
      password: "Ficticia#2026",
    })
    expect(parsed.success).toBe(true)
  })

  it("requires first name on signup", () => {
    expect(
      signUpSchema.safeParse({
        email: "marina@vagapilot.test",
        password: "Ficticia#2026",
      }).success
    ).toBe(false)
    expect(
      signUpSchema.safeParse({
        firstName: "Marina",
        email: "marina@vagapilot.test",
        password: "Ficticia#2026",
      }).success
    ).toBe(true)
  })
})
