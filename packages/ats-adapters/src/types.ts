import type { JobSource } from "@vagapilot/core/tracker"

export type { JobSource }

/** Raw public posting as read from the source, before LLM normalization (spec 11.1). */
export type RawJobPosting = {
  source: JobSource
  canonicalUrl: string
  externalId: string | null
  title: string
  company: string | null
  companyDomain: string | null
  location: string | null
  workModelHint: "presencial" | "hibrido" | "remoto" | null
  /** Raw contract text from the source ("Efetivo", "FULL_TIME", "PJ"...). */
  employmentTypeHint: string | null
  /** Plain text with line breaks and "- " bullets; HTML already stripped. */
  descriptionText: string
  /** Structured requirement lists when the source has them (Lever lists, Gupy prerequisites). */
  requirementsHint: { required: string[]; preferred: string[] } | null
  salary: {
    min: number | null
    max: number | null
    currency: string | null
    period: string | null
  } | null
  /** YYYY-MM-DD */
  postedAt: string | null
  applyUrl: string | null
  applyEmail: string | null
  /** RF4A.2: the posting sends candidates to another ATS (LinkedIn → company ATS). */
  externalApply: { url: string; source: JobSource } | null
}

export type ExtractFailureCode =
  | "not_found"
  | "http_error"
  | "timeout"
  | "network"
  | "parse_error"
  | "unsupported"

export type ExtractResult =
  | { status: "ok"; posting: RawJobPosting; fromCache: boolean }
  | { status: "blocked"; reason: "rate_limited" | "forbidden" }
  | { status: "failed"; code: ExtractFailureCode }

export type CachedResponse = {
  status: number
  body: string
  contentType: string | null
}

/** 24 h response cache per request URL (RF4.5, F15 RF15.1). */
export interface JobCache {
  get(key: string): Promise<CachedResponse | null>
  set(key: string, value: CachedResponse, ttlMs: number): Promise<void>
}

/**
 * Everything an adapter may use. There is deliberately no place for user credentials,
 * cookies or sessions (11.1: `extract` não recebe credenciais do usuário; CA4.3).
 */
export type FetchCtx = {
  fetch: typeof fetch
  cache?: JobCache
  userAgent?: string
  timeoutMs?: number
  /** Third-party fallbacks when the direct read is blocked (see providers.ts). */
  providers?: import("./providers.js").FetchProvider[]
  /** Total time for the provider chain, so ingestion stays inside its 50 s deadline. */
  providerBudgetMs?: number
}

export interface JobSourceAdapter {
  source: JobSource
  matches(url: URL): boolean
  canonicalize(url: URL): string
  extract(url: URL, ctx: FetchCtx): Promise<ExtractResult>
}
