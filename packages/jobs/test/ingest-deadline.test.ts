import { describe, expect, it, vi } from "vitest"

import { withDeadline } from "../src/start-ingestion"

describe("withDeadline (link stuck in 'Analisando…')", () => {
  it("closes the row and rejects when the work never ends", async () => {
    const onTimeout = vi.fn(async () => {})
    await expect(
      withDeadline(new Promise(() => {}), 20, onTimeout)
    ).rejects.toThrow(/timed out/)
    expect(onTimeout).toHaveBeenCalledOnce()
  })
  it("returns the result and never closes when the work ends in time", async () => {
    const onTimeout = vi.fn(async () => {})
    await expect(withDeadline(Promise.resolve(7), 50, onTimeout)).resolves.toBe(
      7
    )
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
