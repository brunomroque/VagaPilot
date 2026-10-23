import { ProviderError, type FetchLike } from "./types.js"

/** JSON request with provider-agnostic error mapping. Never includes secrets in messages. */
export async function requestJson<T>(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000)
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    throw new ProviderError(
      aborted ? "timeout" : "unavailable",
      `${provider}: ${aborted ? "timeout" : "network error"}`
    )
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const status = response.status
    const code =
      status === 401 || status === 403
        ? "auth"
        : status === 402
          ? "quota"
          : status === 429
            ? "concurrency"
            : "unavailable"
    let detail = ""
    try {
      detail = (await response.text()).slice(0, 200)
    } catch {
      detail = ""
    }
    throw new ProviderError(
      code,
      `${provider}: HTTP ${status}${detail ? ` ${scrub(detail)}` : ""}`,
      status
    )
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderError("bad_response", `${provider}: invalid JSON`)
  }
}

/** Removes anything that looks like a token from provider error text. */
export function scrub(text: string): string {
  return text
    .replace(/(token|apikey|api_key|key)=([^&\s"]+)/gi, "$1=***")
    .replace(/[A-Za-z0-9_-]{32,}/g, "***")
}
