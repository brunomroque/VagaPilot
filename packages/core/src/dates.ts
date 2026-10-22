/** Time-zone aware date helpers (spec 7: user time zone; storage in UTC). Pure: no I/O. */

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo"

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    partsFormatters.set(timeZone, formatter)
  }
  return formatter
}

export function zonedParts(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE
): ZonedParts {
  const values: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value)
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
  }
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0")
}

/** dd/mm/aaaa in the given time zone (CA10.1). */
export function formatDateBR(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${pad(day)}/${pad(month)}/${pad(year, 4)}`
}

/** dd/mm/aaaa HH:mm in the given time zone. */
export function formatDateTimeBR(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE
): string {
  const { hour, minute } = zonedParts(date, timeZone)
  return `${formatDateBR(date, timeZone)} ${pad(hour)}:${pad(minute)}`
}

/** `YYYY-MM` of the date in the given time zone. */
export function monthKey(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const { year, month } = zonedParts(date, timeZone)
  return `${pad(year, 4)}-${pad(month)}`
}

/** Converts a wall-clock time in `timeZone` to the UTC instant. */
export function zonedTimeToUtc(
  parts: ZonedParts,
  timeZone = DEFAULT_TIME_ZONE
): Date {
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  )
  let guess = wall
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seen = zonedParts(new Date(guess), timeZone)
    const seenWall = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute
    )
    guess += wall - seenWall
  }
  return new Date(guess)
}

/** Start of the month containing `date`, in `timeZone`, as a UTC instant. */
export function startOfZonedMonth(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE
): Date {
  const { year, month } = zonedParts(date, timeZone)
  return zonedTimeToUtc({ year, month, day: 1, hour: 0, minute: 0 }, timeZone)
}

/** Start of the year containing `date`, in `timeZone`, as a UTC instant. */
export function startOfZonedYear(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE
): Date {
  const { year } = zonedParts(date, timeZone)
  return zonedTimeToUtc(
    { year, month: 1, day: 1, hour: 0, minute: 0 },
    timeZone
  )
}

const BR_DATE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/

function validParts(parts: ZonedParts): boolean {
  if (parts.month < 1 || parts.month > 12 || parts.day < 1) return false
  if (parts.hour > 23 || parts.minute > 59) return false
  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month, 0)
  ).getUTCDate()
  return parts.day <= daysInMonth
}

/**
 * Parses `dd/mm/aaaa`, `dd/mm/aa`, `aaaa-mm-dd` (each with optional `HH:mm`) or full ISO-8601.
 * Wall-clock values are read in `timeZone`. Returns null when the text is not a real date.
 */
export function parseUserDate(
  text: string,
  timeZone = DEFAULT_TIME_ZONE
): Date | null {
  const value = text.trim()
  if (value === "") return null

  const br = BR_DATE.exec(value)
  if (br) {
    const rawYear = Number(br[3])
    const parts: ZonedParts = {
      day: Number(br[1]),
      month: Number(br[2]),
      year: br[3]?.length === 2 ? 2000 + rawYear : rawYear,
      hour: br[4] ? Number(br[4]) : 0,
      minute: br[5] ? Number(br[5]) : 0,
    }
    return validParts(parts) ? zonedTimeToUtc(parts, timeZone) : null
  }

  const iso = ISO_DATE.exec(value)
  if (iso) {
    const parts: ZonedParts = {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hour: iso[4] ? Number(iso[4]) : 0,
      minute: iso[5] ? Number(iso[5]) : 0,
    }
    if (!validParts(parts)) return null
    if (iso[6]) {
      const date = new Date(value.replace(" ", "T"))
      return Number.isNaN(date.getTime()) ? null : date
    }
    return zonedTimeToUtc(parts, timeZone)
  }
  return null
}
