import { describe, expect, it } from "vitest"

import {
  checkIntegrationActivation,
  integrationRiskLevel,
} from "./integrations.js"
import { dueReminderWindow, reminderDedupeKey } from "./reminders.js"

const due = new Date("2026-10-26T02:59:00Z")
const hoursBefore = (hours: number) =>
  new Date(due.getTime() - hours * 3_600_000)

describe("RF11.6 reminders 48 h and 12 h before the deadline", () => {
  it("picks the window that is open now", () => {
    expect(dueReminderWindow(due, hoursBefore(60))).toBeNull()
    expect(dueReminderWindow(due, hoursBefore(48))).toBe("48h")
    expect(dueReminderWindow(due, hoursBefore(13))).toBe("48h")
    expect(dueReminderWindow(due, hoursBefore(12))).toBe("12h")
    expect(dueReminderWindow(due, hoursBefore(0.5))).toBe("12h")
    expect(dueReminderWindow(due, hoursBefore(-1))).toBeNull()
  })

  it("dedupes per application, deadline and window", () => {
    expect(reminderDedupeKey("app", due, "48h")).toBe(
      "reminder:app:2026-10-26T02:59:00.000Z:48h"
    )
    expect(reminderDedupeKey("app", due, "12h")).not.toBe(
      reminderDedupeKey("app", due, "48h")
    )
  })
})

describe("integration activation hook (F16 lands in P6)", () => {
  it("allows activation until risk acceptance is required, then requires it", () => {
    expect(integrationRiskLevel("gmail")).toBe("medio")
    expect(
      checkIntegrationActivation({
        riskAcceptanceRequired: false,
        riskAccepted: false,
      })
    ).toEqual({ ok: true })
    expect(
      checkIntegrationActivation({
        riskAcceptanceRequired: true,
        riskAccepted: false,
      })
    ).toEqual({ ok: false, reason: "risk_acceptance_required" })
    expect(
      checkIntegrationActivation({
        riskAcceptanceRequired: true,
        riskAccepted: true,
      })
    ).toEqual({ ok: true })
  })
})
