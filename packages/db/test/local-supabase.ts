import { execSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type LocalSupabase = {
  url: string
  anonKey: string
  serviceRoleKey: string
}

export type LocalSupabaseResult =
  { ok: true; env: LocalSupabase } | { ok: false; reason: string }

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Fictitious seed users (supabase/seed.sql). */
export const seedUsers = {
  a: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "marina@vagapilot.test",
  },
  b: {
    id: "22222222-2222-4222-8222-222222222222",
    email: "rafael@vagapilot.test",
  },
  password: "Ficticia#2026",
} as const

function fromEnv(): LocalSupabase | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) return null
  return { url, anonKey, serviceRoleKey }
}

function fromCli(): LocalSupabase | null {
  try {
    const raw = execSync("supabase status -o json", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      encoding: "utf8",
    })
    const start = raw.indexOf("{")
    if (start === -1) return null
    const status = JSON.parse(raw.slice(start)) as Record<
      string,
      string | undefined
    >
    const url = status.API_URL
    const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY
    const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
    if (!url || !anonKey || !serviceRoleKey) return null
    return { url, anonKey, serviceRoleKey }
  } catch {
    return null
  }
}

/**
 * Resolves the local Supabase stack from env vars or `supabase status`.
 * Never fakes a connection: if the API does not answer, callers must skip.
 */
export async function resolveLocalSupabase(): Promise<LocalSupabaseResult> {
  const env = fromEnv() ?? fromCli()
  if (!env) {
    return {
      ok: false,
      reason:
        "SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY not set and `supabase status` failed. Run `supabase start && pnpm db:reset`.",
    }
  }
  try {
    const response = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.anonKey },
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) {
      return {
        ok: false,
        reason: `Supabase at ${env.url} answered ${response.status}.`,
      }
    }
  } catch {
    return {
      ok: false,
      reason: `Supabase at ${env.url} is not reachable. Run \`supabase start\`.`,
    }
  }
  return { ok: true, env }
}
