/** Distributed concurrency slots per provider (Upstash in prod, memory locally/tests). */
export interface ConcurrencyStore {
  /** Atomically takes a slot if fewer than `limit` are in use. */
  tryAcquire(providerId: string, limit: number, ttlSeconds: number): Promise<boolean>
  release(providerId: string): Promise<void>
  inUse(providerId: string): Promise<number>
}

export class MemoryConcurrencyStore implements ConcurrencyStore {
  private readonly slots = new Map<string, number>()
  async tryAcquire(id: string, limit: number): Promise<boolean> {
    const current = this.slots.get(id) ?? 0
    if (current >= limit) return false
    this.slots.set(id, current + 1)
    return true
  }
  async release(id: string): Promise<void> {
    this.slots.set(id, Math.max(0, (this.slots.get(id) ?? 0) - 1))
  }
  async inUse(id: string): Promise<number> {
    return this.slots.get(id) ?? 0
  }
}

type RedisLike = {
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
  get<T>(key: string): Promise<T | null>
}

/**
 * INCR-then-check counter. The TTL is a safety net: a crashed run frees its slot after the
 * longest possible session instead of blocking the provider forever.
 */
export class RedisConcurrencyStore implements ConcurrencyStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "vp:browser-pool:slots"
  ) {}
  private key(id: string) {
    return `${this.prefix}:${id}`
  }
  async tryAcquire(id: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const value = await this.redis.incr(this.key(id))
    await this.redis.expire(this.key(id), ttlSeconds)
    if (value > limit) {
      await this.redis.decr(this.key(id))
      return false
    }
    return true
  }
  async release(id: string): Promise<void> {
    const value = await this.redis.decr(this.key(id))
    if (value < 0) await this.redis.incr(this.key(id))
  }
  async inUse(id: string): Promise<number> {
    return Math.max(0, Number((await this.redis.get<number>(this.key(id))) ?? 0))
  }
}

export async function concurrencyStoreFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<ConcurrencyStore> {
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return sharedMemoryStore
  const { Redis } = await import("@upstash/redis")
  return new RedisConcurrencyStore(new Redis({ url, token }) as unknown as RedisLike)
}

const sharedMemoryStore = new MemoryConcurrencyStore()
