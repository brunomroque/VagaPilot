import { NextResponse } from "next/server"

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "not_configured"
  | "internal_error"
  | "not_found"
  | "conflict"
  | "file_too_large"
  | "file_empty"
  | "unsupported_type"
  | "too_many_pages"
  | "no_text"
  | "unreadable"
  | "invalid_track"
  | "input_too_long"
  | "rate_limited"
  | "too_many_links"

/**
 * Same-origin redirect with a relative Location, so the browser keeps the host it used
 * (127.0.0.1 vs localhost) and the cookies set on this response stay valid.
 */
export function redirectRelative(pathWithQuery: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: pathWithQuery },
  })
}

/** Spec 8.5 error envelope: { error: { code, message } }. */
export function apiError(code: ApiErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
