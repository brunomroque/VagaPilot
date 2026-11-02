import { describe, expect, it } from "vitest"

import { nonBlank, resolveAppUrl } from "./app-url.js"

describe("resolveAppUrl", () => {
  it("accepts localhost in development and rejects it in production", () => {
    expect(
      resolveAppUrl({
        configured: "http://localhost:3100/",
        nodeEnv: "development",
      })
    ).toEqual({ ok: true, url: "http://localhost:3100" })
    expect(
      resolveAppUrl({
        configured: "http://localhost:3000",
        nodeEnv: "production",
      })
    ).toEqual({ ok: false, reason: "local_in_production" })
    expect(resolveAppUrl({ configured: "", nodeEnv: "production" })).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(
      resolveAppUrl({
        configured: "https://vagapilot.netlify.app/",
        nodeEnv: "production",
      })
    ).toEqual({ ok: true, url: "https://vagapilot.netlify.app" })
  })

  it("honors allowLocal in production for loopback only", () => {
    expect(
      resolveAppUrl({
        configured: "http://127.0.0.1:3100",
        nodeEnv: "production",
        allowLocal: true,
      })
    ).toEqual({ ok: true, url: "http://127.0.0.1:3100" })
    expect(
      resolveAppUrl({
        configured: "http://localhost:3100",
        nodeEnv: "production",
        allowLocal: true,
      })
    ).toEqual({ ok: true, url: "http://localhost:3100" })
    expect(
      resolveAppUrl({
        configured: "http://127.0.0.1:3100",
        nodeEnv: "production",
        allowLocal: false,
      })
    ).toEqual({ ok: false, reason: "local_in_production" })
    expect(
      resolveAppUrl({
        configured: "http://evil.test",
        nodeEnv: "production",
        allowLocal: true,
      })
    ).toEqual({ ok: false, reason: "invalid" })
  })

  it("treats a blank env value as missing", () => {
    expect(nonBlank("")).toBeNull()
    expect(nonBlank("  ")).toBeNull()
    expect(nonBlank(undefined)).toBeNull()
    expect(nonBlank(" price_x ")).toBe("price_x")
  })
})
