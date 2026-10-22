/** Result envelope of server actions (spec 8.5 error shape). Safe to import in client code. */

export const ACTION_ERROR_CODES = [
  "unauthorized",
  "not_configured",
  "invalid_request",
  "not_found",
  "conflict",
  "consent_required",
  "internal_error",
] as const

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number]

export type ActionError = { code: ActionErrorCode; message: string }

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: ActionError }

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function fail(
  code: ActionErrorCode,
  message: string
): ActionResult<never> {
  return { ok: false, error: { code, message } }
}
