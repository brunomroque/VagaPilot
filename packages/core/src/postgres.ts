/** True for a Postgres unique violation (23505), including PostgREST's message. */
export function isUniqueViolation(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false
  if (error.code === "23505") return true
  return /duplicate key value/i.test(error.message ?? "")
}
