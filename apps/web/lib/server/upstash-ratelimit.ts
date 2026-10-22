import "server-only"

/** Distributed rate limit when Upstash is configured; otherwise callers use DB/local limits. */
export type RateLimitResult =
  | { limited: false; source: "upstash" | "skipped" }
  | { limited: true; source: "upstash"; retryAfterSeconds?: number }

export async function checkUpstashRateLimit(
  key: string,
  limit: number,
  window: `${number} ${"s" | "m" | "h" | "d"}`
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { limited: false, source: "skipped" }

  const { Ratelimit } = await import("@upstash/ratelimit")
  const { Redis } = await import("@upstash/redis")

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: "vp:rl",
  })
  const result = await ratelimit.limit(key)
  if (result.success) return { limited: false, source: "upstash" }
  return {
    limited: true,
    source: "upstash",
    retryAfterSeconds: Math.ceil((result.reset - Date.now()) / 1000),
  }
}
