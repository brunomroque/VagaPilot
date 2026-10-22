import type {
  CachedResponse,
  ExtractResult,
  FetchCtx,
  JobCache,
} from "./types.js"

/** Identifiable user agent (P2.1). Never a browser UA, never user cookies. */
export const VAGAPILOT_USER_AGENT =
  "VagaPilotBot/0.1 (+https://vagapilot.app/bot; leitura publica de vagas sob pedido do usuario)"
export const FETCH_TIMEOUT_MS = 10_000
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export class MemoryJobCache implements JobCache {
  private readonly entries = new Map<
    string,
    { value: CachedResponse; expiresAt: number }
  >()

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<CachedResponse | null> {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, value: CachedResponse, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs })
  }
}

export type FetchOutcome =
  | { ok: true; response: CachedResponse; fromCache: boolean }
  | { ok: false; result: Exclude<ExtractResult, { status: "ok" }> }

function failureFor(status: number): Exclude<ExtractResult, { status: "ok" }> {
  if (status === 429 || status === 999)
    return { status: "blocked", reason: "rate_limited" }
  if (status === 404 || status === 410)
    return { status: "failed", code: "not_found" }
  return { status: "failed", code: "http_error" }
}

/**
 * One GET per URL with timeout, identifiable UA, `credentials: "omit"` and no cookie header.
 * Successful bodies are cached for 24 h, so pasting the same link again does not refetch.
 */
export async function fetchPublic(
  ctx: FetchCtx,
  url: string,
  options: { accept?: string; forbiddenIsBlocked?: boolean } = {}
): Promise<FetchOutcome> {
  const cached = await ctx.cache?.get(url)
  if (cached) return { ok: true, response: cached, fromCache: true }

  let response: Response
  try {
    response = await ctx.fetch(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      headers: {
        "User-Agent": ctx.userAgent ?? VAGAPILOT_USER_AGENT,
        Accept: options.accept ?? "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(ctx.timeoutMs ?? FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    return {
      ok: false,
      result: {
        status: "failed",
        code:
          name === "TimeoutError" || name === "AbortError"
            ? "timeout"
            : "network",
      },
    }
  }

  if (options.forbiddenIsBlocked && response.status === 403) {
    return { ok: false, result: { status: "blocked", reason: "forbidden" } }
  }
  if (!response.ok) return { ok: false, result: failureFor(response.status) }

  const value: CachedResponse = {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type"),
  }
  await ctx.cache?.set(url, value, CACHE_TTL_MS)
  return { ok: true, response: value, fromCache: false }
}

export function parseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}
