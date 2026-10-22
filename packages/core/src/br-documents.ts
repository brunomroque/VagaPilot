import { isValidCpf } from "./redact.js"

/** Brazilian document helpers (pure). CPF check digits live in `redact.ts` (`isValidCpf`). */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "")
}

/** Accepts formatted ("123.456.789-09") or bare CPF input. */
export function isValidCpfInput(value: string): boolean {
  return isValidCpf(onlyDigits(value))
}

/** "12345678909" → "123.456.789-09". Returns the input when it is not 11 digits. */
export function formatCpf(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length !== 11) return value
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}
