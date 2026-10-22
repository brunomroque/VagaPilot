/**
 * Deadlines and interview times written in e-mails (F11 RF11.5, CA11.2). Pure: no I/O.
 * Wall-clock values are read in the user's time zone (default America/Sao_Paulo); a date
 * without a year is the next occurrence on or after the day the e-mail arrived; a date without
 * a time ends the day (23:59).
 */

import { DEFAULT_TIME_ZONE, zonedParts, zonedTimeToUtc } from "./dates.js"

const MONTHS: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  january: 1,
  fevereiro: 2,
  fev: 2,
  february: 2,
  feb: 2,
  marco: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  maio: 5,
  mai: 5,
  may: 5,
  junho: 6,
  jun: 6,
  june: 6,
  julho: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  setembro: 9,
  set: 9,
  september: 9,
  sep: 9,
  sept: 9,
  outubro: 10,
  out: 10,
  october: 10,
  oct: 10,
  novembro: 11,
  nov: 11,
  november: 11,
  dezembro: 12,
  dez: 12,
  december: 12,
  dec: 12,
}

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|")

/**
 * Optional time after a date. The hour needs a marker (`:MM`, `h`, `horas`, am/pm) so numbers
 * like "25/10 3 vagas" are not read as times. Groups: hour, minute, minute, am/pm, am/pm, zone.
 */
const TIME = String.raw`(?:\s*,?\s*(?:(?:às|as|at|@|a partir das|-)\s*)?(\d{1,2})(?:(?::(\d{2})|h(\d{2})?)\s*(am|pm)?|\s*(?:horas|hrs?)\b|\s*(am|pm)\b)(?:\s*\(?\s*(utc|gmt|brt|hor[aá]rio de bras[ií]lia)\)?)?)?`

/** Day-month order (PT and "25 October"), month-day order (EN) and ISO dates. */
const DATE_PATTERNS: {
  regex: RegExp
  read: (m: RegExpExecArray) => DateBits
}[] = [
  {
    regex: new RegExp(
      String.raw`\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?`,
      "giu"
    ),
    read: (m) => ({
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] ? Number(m[4]) : null,
      minute: m[5] ? Number(m[5]) : null,
      meridiem: null,
      zone: null,
    }),
  },
  {
    regex: new RegExp(
      String.raw`\b(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?\b${TIME}`,
      "giu"
    ),
    read: (m) => ({
      day: Number(m[1]),
      month: Number(m[2]),
      year: m[3]
        ? m[3].length === 2
          ? 2000 + Number(m[3])
          : Number(m[3])
        : null,
      ...timeBits(m, 4),
    }),
  },
  {
    regex: new RegExp(
      String.raw`\b(\d{1,2})(?:º|°|st|nd|rd|th)?\s+(?:de\s+)?(${MONTH_NAMES})\.?(?:\s+(?:de\s+)?(\d{4}))?\b${TIME}`,
      "giu"
    ),
    read: (m) => ({
      day: Number(m[1]),
      month: MONTHS[stripAccents(m[2] ?? "").toLowerCase()] ?? 0,
      year: m[3] ? Number(m[3]) : null,
      ...timeBits(m, 4),
    }),
  },
  {
    regex: new RegExp(
      String.raw`\b(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b${TIME}`,
      "giu"
    ),
    read: (m) => ({
      month: MONTHS[stripAccents(m[1] ?? "").toLowerCase()] ?? 0,
      day: Number(m[2]),
      year: m[3] ? Number(m[3]) : null,
      ...timeBits(m, 4),
    }),
  },
]

const RELATIVE =
  /\b(?:em até|em ate|dentro de|no prazo de|within|in the next|in)\s+(\d{1,2})\s+(dias?|days?|horas?|hours?)\b/giu

const DEADLINE_CUES =
  /(até|ate|prazo|data limite|limite|deadline|due|by|until|before|antes d[eo]|expira|encerra|submit|entregar|responder|concluir|complete)/iu

type DateBits = {
  year: number | null
  month: number
  day: number
  hour: number | null
  minute: number | null
  meridiem: string | null
  zone: string | null
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

function timeBits(m: RegExpExecArray, start: number) {
  const minute = m[start + 1] ?? m[start + 2]
  return {
    hour: m[start] ? Number(m[start]) : null,
    minute: minute ? Number(minute) : null,
    meridiem: (m[start + 3] ?? m[start + 4])?.toLowerCase() ?? null,
    zone: m[start + 5]?.toLowerCase() ?? null,
  }
}

export type DateMention = {
  /** UTC instant. */
  at: Date
  hasTime: boolean
  /** Position in the text, for ordering. */
  index: number
  /** Up to 40 characters before the date (used to find deadline cues). */
  before: string
  text: string
}

const YEAR_ROLLOVER_MS = 90 * 86_400_000

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toInstant(
  bits: DateBits,
  receivedAt: Date,
  timeZone: string
): {
  at: Date
  hasTime: boolean
} | null {
  if (bits.month < 1 || bits.month > 12 || bits.day < 1) return null
  let hour = bits.hour
  if (hour !== null && bits.meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (bits.meridiem === "pm" ? 12 : 0)
  }
  const minute = bits.minute ?? 0
  // An impossible time ("25:00") keeps the date and ends the day.
  if (hour !== null && (hour > 23 || minute > 59)) hour = null

  const received = zonedParts(receivedAt, timeZone)
  let year = bits.year ?? received.year
  if (bits.day > daysInMonth(year, bits.month)) return null
  if (bits.year === null) {
    const sameYear = Date.UTC(year, bits.month - 1, bits.day)
    const receivedDay = Date.UTC(
      received.year,
      received.month - 1,
      received.day
    )
    // "05/01" in a December e-mail is next January; "18/10" in an October one is this year.
    if (sameYear < receivedDay - YEAR_ROLLOVER_MS) year += 1
  }
  const parts = {
    year,
    month: bits.month,
    day: bits.day,
    hour: hour ?? 23,
    minute: hour === null ? 59 : minute,
  }
  const utc = bits.zone === "utc" || bits.zone === "gmt"
  const at = utc
    ? new Date(
        Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute
        )
      )
    : zonedTimeToUtc(parts, timeZone)
  return { at, hasTime: hour !== null }
}

/** Every absolute or relative date in the text, in reading order. */
export function findDateMentions(
  text: string,
  receivedAt: Date,
  timeZone = DEFAULT_TIME_ZONE
): DateMention[] {
  const mentions: DateMention[] = []
  const taken: [number, number][] = []
  const overlaps = (start: number, end: number) =>
    taken.some(([a, b]) => start < b && end > a)

  for (const { regex, read } of DATE_PATTERNS) {
    regex.lastIndex = 0
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      const start = match.index
      const end = start + match[0].length
      if (overlaps(start, end)) continue
      const instant = toInstant(read(match), receivedAt, timeZone)
      if (!instant) continue
      taken.push([start, end])
      mentions.push({
        ...instant,
        index: start,
        before: text.slice(Math.max(0, start - 40), start),
        text: match[0].trim(),
      })
    }
  }

  RELATIVE.lastIndex = 0
  for (let match = RELATIVE.exec(text); match; match = RELATIVE.exec(text)) {
    if (overlaps(match.index, match.index + match[0].length)) continue
    const amount = Number(match[1])
    const unit = stripAccents(match[2] ?? "").toLowerCase()
    let at: Date
    let hasTime: boolean
    if (unit.startsWith("hora") || unit.startsWith("hour")) {
      at = new Date(receivedAt.getTime() + amount * 3_600_000)
      hasTime = true
    } else {
      const base = zonedParts(
        new Date(receivedAt.getTime() + amount * 86_400_000),
        timeZone
      )
      at = zonedTimeToUtc({ ...base, hour: 23, minute: 59 }, timeZone)
      hasTime = false
    }
    mentions.push({
      at,
      hasTime,
      index: match.index,
      before: `${text.slice(Math.max(0, match.index - 40), match.index)} até`,
      text: match[0].trim(),
    })
  }

  return mentions.sort((a, b) => a.index - b.index)
}

/**
 * Deadline of a test/stage e-mail (CA11.2): the first date preceded by a deadline cue
 * ("até", "prazo", "by", "until"…); otherwise the first future date when `fallbackToFirst`.
 */
export function parseDeadline(
  text: string,
  receivedAt: Date,
  options: { timeZone?: string; fallbackToFirst?: boolean } = {}
): Date | null {
  const mentions = findDateMentions(
    text,
    receivedAt,
    options.timeZone ?? DEFAULT_TIME_ZONE
  )
  const cued = mentions.find((mention) =>
    DEADLINE_CUES.test(mention.before.slice(-25))
  )
  if (cued) return cued.at
  if (!options.fallbackToFirst) return null
  return (
    mentions.find((mention) => mention.at.getTime() >= receivedAt.getTime())
      ?.at ?? null
  )
}

/** Interview time of an invite: the first future date with a time, else the first future date. */
export function parseInterviewTime(
  text: string,
  receivedAt: Date,
  timeZone = DEFAULT_TIME_ZONE
): Date | null {
  const future = findDateMentions(text, receivedAt, timeZone).filter(
    (mention) => mention.at.getTime() >= receivedAt.getTime()
  )
  return (future.find((mention) => mention.hasTime) ?? future[0])?.at ?? null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** ISO-8601 with the zone's offset, e.g. `2026-10-25T23:59:00-03:00` (10.5 `deadline`). */
export function toZonedIso(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = zonedParts(date, timeZone)
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  )
  const offsetMinutes = Math.round(
    (wall - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000
  )
  const sign = offsetMinutes < 0 ? "-" : "+"
  const abs = Math.abs(offsetMinutes)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute
  )}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Accepts only ISO-8601 with an explicit offset or `Z` (10.5); null otherwise. */
export function parseIsoWithOffset(
  value: string | null | undefined
): Date | null {
  if (!value) return null
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      value
    )
  ) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
