/** Deadline reminders 48 h and 12 h before (F11 RF11.6, P4.3). Pure: no I/O. */

export const REMINDER_WINDOWS = ["48h", "12h"] as const

export type ReminderWindow = (typeof REMINDER_WINDOWS)[number]

export function reminderWindowHours(window: ReminderWindow): number {
  switch (window) {
    case "48h":
      return 48
    case "12h":
      return 12
    default: {
      const unreachable: never = window
      throw new Error(`Unknown reminder window: ${String(unreachable)}`)
    }
  }
}

/**
 * The reminder due now for a deadline, if any. A job that runs late inside the 12 h window sends
 * only the 12 h reminder; past deadlines get none.
 */
export function dueReminderWindow(
  dueAt: Date,
  now: Date
): ReminderWindow | null {
  const hoursLeft = (dueAt.getTime() - now.getTime()) / 3_600_000
  if (hoursLeft <= 0) return null
  if (hoursLeft <= reminderWindowHours("12h")) return "12h"
  if (hoursLeft <= reminderWindowHours("48h")) return "48h"
  return null
}

/** One reminder per application, deadline and window; a moved deadline gets new reminders. */
export function reminderDedupeKey(
  applicationId: string,
  dueAt: Date,
  window: ReminderWindow
): string {
  return `reminder:${applicationId}:${dueAt.toISOString()}:${window}`
}
