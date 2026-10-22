/** RFC 4180 CSV helpers tuned for Excel PT-BR (F10 RF10.5, CA10.1). Pure: no I/O. */

export const UTF8_BOM = "\uFEFF"

export interface CsvWriteOptions {
  /** Excel PT-BR expects `;` because `,` is the decimal separator. */
  delimiter?: string
  /** Prefix the byte order mark so Excel detects UTF-8 and keeps accents. */
  bom?: boolean
}

/** Cells starting with these characters run as formulas in spreadsheets (CSV injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function escapeCsvCell(value: string, delimiter = ";"): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value
  const needsQuotes =
    safe.includes(delimiter) ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  return needsQuotes ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** Serializes rows with CRLF line endings. */
export function toCsv(
  rows: readonly (readonly string[])[],
  options: CsvWriteOptions = {}
): string {
  const delimiter = options.delimiter ?? ";"
  const body = rows
    .map((row) =>
      row.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter)
    )
    .join("\r\n")
  return `${options.bom === false ? "" : UTF8_BOM}${body}\r\n`
}

const DELIMITER_CANDIDATES = [";", ",", "\t"] as const

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === delimiter) count += 1
  }
  return count
}

/** Picks the delimiter that splits the header line the most. Defaults to `;`. */
export function detectCsvDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? ""
  let best: string = ";"
  let bestCount = 0
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = countOutsideQuotes(firstLine, candidate)
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text
}

/** Parses CSV text (quotes, escaped quotes, CRLF/LF, BOM). Blank lines are dropped. */
export function parseCsv(
  text: string,
  delimiter = detectCsvDelimiter(text)
): string[][] {
  const source = stripBom(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  const pushRow = () => {
    row.push(cell)
    if (row.some((value) => value.trim() !== "")) rows.push(row)
    row = []
    cell = ""
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ""
    } else if (char === "\n") {
      pushRow()
    } else if (char === "\r") {
      if (source[index + 1] === "\n") index += 1
      pushRow()
    } else {
      cell += char
    }
  }
  if (cell !== "" || row.length > 0) pushRow()
  return rows
}
