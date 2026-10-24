import process from "node:process"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  MemoryJobCache,
  providersFromEnv,
  type FetchCtx,
} from "@vagapilot/ats-adapters"
import { createFixtureFetch } from "@vagapilot/ats-adapters/fixtures"
import { SupabaseAuditSink } from "@vagapilot/db/server"

import type { IngestDeps } from "./ingest.js"
import type { CvProcessingDeps } from "./process-cv.js"

type Env = Readonly<Record<string, string | undefined>>

/** service_role Supabase client for jobs. Server only; never expose the key to the browser. */
export function createAdminClient(env: Env = process.env): SupabaseClient {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required"
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createCvProcessingDeps(
  overrides: Partial<CvProcessingDeps> = {}
): CvProcessingDeps {
  const admin = overrides.admin ?? createAdminClient()
  return {
    admin,
    audit: overrides.audit ?? new SupabaseAuditSink(admin),
    ...overrides,
  }
}

/** Recorded FICTITIOUS responses instead of the network: dev and e2e only, never production. */
export function useAtsFixtures(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.VAGAPILOT_ATS_FIXTURES === "1"
}

const sharedCache = new MemoryJobCache()

/** Public fetch with the 24 h cache (RF4.5), or the fixture fetch in dev/e2e. */
export function createJobFetchCtx(env: Env = process.env): FetchCtx {
  return useAtsFixtures(env)
    ? { fetch: createFixtureFetch({ delayMs: 150 }), cache: sharedCache }
    : {
        fetch: globalThis.fetch.bind(globalThis),
        cache: sharedCache,
        // Direct reads get 8 s each; the SaaS chain gets 20 s in total, leaving the rest of
        // the 50 s inline deadline (INLINE_DEADLINE_MS) for analysis.
        timeoutMs: 8_000,
        providers: providersFromEnv(env),
        providerBudgetMs: 20_000,
      }
}

export function createIngestDeps(
  overrides: Partial<IngestDeps> = {}
): IngestDeps {
  const admin = overrides.admin ?? createAdminClient()
  return {
    admin,
    audit: overrides.audit ?? new SupabaseAuditSink(admin),
    fetchCtx: overrides.fetchCtx ?? createJobFetchCtx(),
    ...overrides,
  }
}
