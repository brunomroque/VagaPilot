/**
 * PII redaction for audit details, logs and LLM traces (spec 12.3 / 10.7).
 * Over-redaction is acceptable; leaking a CPF, e-mail or phone is not.
 */

export const REDACTED_CPF = "[REDACTED_CPF]"
export const REDACTED_EMAIL = "[REDACTED_EMAIL]"
export const REDACTED_PHONE = "[REDACTED_PHONE]"
export const REDACTED_SECRET = "[REDACTED_SECRET]"
export const REDACTED_BINARY = "[REDACTED_BINARY]"
export const REDACTED_CIRCULAR = "[CIRCULAR]"

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const CPF_FORMATTED_RE = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g
const ELEVEN_DIGITS_RE = /(?<!\d)\d{11}(?!\d)/g
const PHONE_WITH_AREA_RE =
  /(?<![\d+])(?:\+?55[\s.-]?)?\(?[1-9]{2}\)?[\s.-]?(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)/g
const PHONE_LOCAL_RE = /(?<![\d+])(?:9\d{4}|[2-8]\d{3})[\s.-]\d{4}(?!\d)/g
const MOBILE_ELEVEN_RE = /^[1-9]{2}9\d{8}$/
const UUID_SPLIT_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const UUID_EXACT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SECRET_KEY_RE =
  /(?:senha|password|passwd|secret|token|otp|cookie|authorization|api[_-]?key)/i
/** key=value secret literals in free text (spec 10.6 secrets-scan). */
const SECRET_ASSIGNMENT_RE =
  /\b(?:senha|password|passwd|secret|token|otp|cookie|authorization|api[_-]?key)\s*=\s*\S+/gi

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const nums = [...digits].map(Number)
  const check = (length: number): number => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += (nums[i] ?? 0) * (length + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return check(9) === nums[9] && check(10) === nums[10]
}

export function redactPIIText(text: string): string {
  return text
    .split(UUID_SPLIT_RE)
    .map((part) => (UUID_EXACT_RE.test(part) ? part : redactSegment(part)))
    .join("")
}

function redactSecretAssignment(match: string): string {
  const eq = match.indexOf("=")
  if (eq === -1) return REDACTED_SECRET
  return `${match.slice(0, eq + 1)}${REDACTED_SECRET}`
}

function redactSegment(text: string): string {
  return text
    .replace(SECRET_ASSIGNMENT_RE, redactSecretAssignment)
    .replace(EMAIL_RE, REDACTED_EMAIL)
    .replace(CPF_FORMATTED_RE, REDACTED_CPF)
    .replace(ELEVEN_DIGITS_RE, (digits) =>
      !isValidCpf(digits) && MOBILE_ELEVEN_RE.test(digits)
        ? REDACTED_PHONE
        : REDACTED_CPF
    )
    .replace(PHONE_WITH_AREA_RE, REDACTED_PHONE)
    .replace(PHONE_LOCAL_RE, REDACTED_PHONE)
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

function redactNode(value: unknown, seen: WeakSet<object>): unknown {
  const kind = typeof value
  switch (kind) {
    case "string":
      return redactPIIText(value as string)
    case "number": {
      const text = String(value)
      const redacted = redactPIIText(text)
      return redacted === text ? value : redacted
    }
    case "bigint": {
      const text = String(value)
      const redacted = redactPIIText(text)
      return redacted === text ? value : redacted
    }
    case "boolean":
    case "undefined":
    case "symbol":
    case "function":
      return value
    case "object": {
      if (value === null) return null
      const obj = value as object
      if (obj instanceof Date) return obj
      if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
        return REDACTED_BINARY
      }
      if (seen.has(obj)) return REDACTED_CIRCULAR
      seen.add(obj)
      try {
        if (Array.isArray(obj)) return obj.map((item) => redactNode(item, seen))
        const out: Record<string, unknown> = {}
        for (const [key, inner] of Object.entries(obj)) {
          out[redactPIIText(key)] = isSecretKey(key)
            ? REDACTED_SECRET
            : redactNode(inner, seen)
        }
        return out
      } finally {
        seen.delete(obj)
      }
    }
    default: {
      const unreachable: never = kind
      throw new Error(`Unhandled value kind: ${String(unreachable)}`)
    }
  }
}

/**
 * Masks CPF (formatted or bare), e-mail and Brazilian phone numbers anywhere
 * in strings, arrays and objects. Values under secret-looking keys
 * (senha, token, otp...) are dropped. Numbers that look like PII become mask
 * strings, so the output shape is only guaranteed JSON-compatible.
 */
export function redactPII(value: string): string
export function redactPII(value: unknown): unknown
export function redactPII(value: unknown): unknown {
  return redactNode(value, new WeakSet())
}
