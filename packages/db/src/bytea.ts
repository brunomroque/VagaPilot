/**
 * PostgREST exchanges `bytea` as hex text (`\x0a1b…`). These helpers convert at the
 * boundary so the rest of the code only sees Uint8Array.
 */

export function toBytea(bytes: Uint8Array): string {
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return `\\x${hex}`
}

export function fromBytea(value: string | null | undefined): Uint8Array | null {
  if (value === null || value === undefined) return null
  const hex = value.startsWith("\\x") ? value.slice(2) : value
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("Invalid bytea hex value")
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
